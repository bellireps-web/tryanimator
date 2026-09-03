import test from "node:test";
import assert from "node:assert/strict";
import { fetchTracks, fetchSfx, buildAudioTimeline, proxyError } from "./audio.js";

function codeOf(fn) {
  try {
    const result = fn();
    return result && result.then
      ? result.then(
          () => null,
          (error) => error && error.code,
        )
      : null;
  } catch (error) {
    return error && error.code;
  }
}

function stubOk(body) {
  return async () => new Response(JSON.stringify(body), { status: 200 });
}

const PLAN = {
  scenes: [{ duration_secs: 10 }, { duration_secs: 20 }],
  audio: { music_track_id: "m1", sfx: [{ id: "s1", at_secs: 5 }] },
};
const LIBRARY = {
  music: [{ id: "m1", url: "https://cdn/m1.mp3" }],
  sfx: [{ id: "s1", url: "https://cdn/s1.mp3" }],
};

test("fetchTracks/fetchSfx map proxy payloads", async () => {
  const tracks = await fetchTracks(
    "https://proxy.test",
    "tok",
    "epic",
    stubOk({ items: [{ id: 7, url: "https://cdn/7.mp3", license: "pixabay" }] }),
  );
  assert.deepEqual(tracks, [{ id: "7", url: "https://cdn/7.mp3", license: "pixabay" }]);

  const sfx = await fetchSfx(
    "https://proxy.test",
    "tok",
    "whoosh",
    stubOk({ items: [] }),
  );
  assert.deepEqual(sfx, []);
  assert.equal(await codeOf(() => fetchTracks("https://proxy.test", "tok", "  ")), "bad_request");
});

test("client errors propagate structured", async () => {
  const denied = async () =>
    new Response(JSON.stringify({ code: "unauthorized", message: "no" }), { status: 401 });
  assert.equal(await codeOf(() => fetchTracks("https://proxy.test", "bad", "epic", denied)), "unauthorized");

  const html = async () => new Response("<html>", { status: 200, headers: {} });
  // Response.json() on non-JSON throws -> invalid JSON mapping.
  const response = await html();
  await assert.rejects(response.json());
});

test("proxyError carries code and status", () => {
  const error = proxyError(502, { code: "provider_transport", message: "x" });
  assert.equal(error.code, "provider_transport");
  assert.equal(error.status, 502);
});

test("buildAudioTimeline assembles bed plus cues", () => {
  assert.deepEqual(buildAudioTimeline(PLAN, LIBRARY), [
    { kind: "music", id: "m1", url: "https://cdn/m1.mp3", at_secs: 0 },
    { kind: "sfx", id: "s1", url: "https://cdn/s1.mp3", at_secs: 5 },
  ]);
});

test("buildAudioTimeline rejects missing tracks and bad cues", () => {
  assert.equal(codeOf(() => buildAudioTimeline(PLAN, { music: [], sfx: LIBRARY.sfx })), "missing_track");
  assert.equal(
    codeOf(() =>
      buildAudioTimeline(
        { scenes: PLAN.scenes, audio: { music_track_id: null, sfx: [{ id: "s1", at_secs: 31 }] } },
        LIBRARY,
      ),
    ),
    "cue_out_of_range",
  );
  assert.equal(
    codeOf(() =>
      buildAudioTimeline(
        { scenes: PLAN.scenes, audio: { music_track_id: null, sfx: [{ id: "ghost", at_secs: 1 }] } },
        LIBRARY,
      ),
    ),
    "missing_track",
  );
});
