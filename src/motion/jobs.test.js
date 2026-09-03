import test from "node:test";
import assert from "node:assert/strict";
import {
  stableJson,
  extractJson,
  buildMotionPlanInput,
  createMotionJob,
  applyPatchOps,
  ProxyAiAdapter,
  runMotionJob,
} from "./jobs.js";

function codeOf(promise) {
  return promise.then(
    () => null,
    (error) => error && error.code,
  );
}

const RESOLUTION = {
  duration_secs: 10,
  style_id: "kinetic-type",
  style_version: "1.0.0",
  scenes: [{ duration_secs: 10, brief: "opening", text: "Hi", transition: "fade" }],
};

function fakeAdapters(overrides = {}) {
  const calls = { renderer: 0, resolve: 0, author: 0 };
  const docs = new Map();
  const blobs = new Map();
  return {
    calls,
    ai: {
      resolveAuto: async () => {
        calls.resolve += 1;
        return JSON.parse(JSON.stringify(RESOLUTION));
      },
      authorScene: async () => {
        calls.author += 1;
        return "<doc/>";
      },
      chatPatch: async () => [{ op: "set_seed", seed: 5 }],
    },
    docs,
    images: { load: async (ref) => ({ ref }) },
    cache: {
      get: async (key) => blobs.get(key) || null,
      put: async (key, blob, bytes) => blobs.set(key, { blob, bytes }),
    },
    renderer: {
      renderSegments: async (plan, { onProgress, segments: segs }) => {
        calls.renderer += 1;
        onProgress(segs.length, segs.length);
        return { segments: segs.length };
      },
    },
    mux: null,
    validate: async () => {},
    ...overrides,
  };
}

function input(overrides = {}) {
  return buildMotionPlanInput({
    prompt: "  neon promo  ",
    ratio: "9:16",
    duration: "auto",
    style: "auto",
    brand: { colors: ["#7069AA"], font: "Figtree" },
    ...overrides,
  });
}

test("stableJson sorts keys", () => {
  assert.equal(stableJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

test("extractJson strips fences", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test("buildMotionPlanInput trims and defaults", () => {
  const built = buildMotionPlanInput({ prompt: " x ", ratio: "3:2" });
  assert.equal(built.prompt, "x");
  assert.equal(built.ratio, "9:16");
  assert.equal(built.duration, "auto");
  assert.deepEqual(built.brand.colors, ["#7069AA"]);
  const job = createMotionJob(built);
  assert.equal(job.state, "queued");
  assert.equal(job.type, "motion");
});

test("applyPatchOps covers all ops immutably", () => {
  const plan = {
    duration: 10,
    style: "auto",
    brand: { colors: ["#FFF"], font: "Figtree" },
    audio: { music_track_id: null, sfx: [] },
    seed: 1,
    scenes: [{ duration_secs: 10, text: "Hi" }],
  };
  const next = applyPatchOps(plan, [
    { op: "set_duration_secs", secs: 15 },
    { op: "set_style_preset", id: "kinetic-type", version: "1.0.0" },
    { op: "set_brand", colors: ["#000"], font: "Lexend" },
    { op: "update_scene", index: 0, text: "Yo" },
    { op: "add_scene", index: 1 },
    { op: "remove_scene", index: 1 },
    { op: "set_music_track", track_id: "m9" },
    { op: "set_seed", seed: 42 },
    { op: "set_style_auto" },
  ]);
  assert.equal(next.duration, 15);
  assert.equal(next.style, "auto");
  assert.deepEqual(next.brand, { colors: ["#000"], font: "Lexend" });
  assert.equal(next.scenes[0].text, "Yo");
  assert.equal(next.scenes.length, 1);
  assert.equal(next.audio.music_track_id, "m9");
  assert.equal(next.seed, 42);
  assert.equal(plan.duration, 10, "input plan untouched");
  const syncCode = (fn) => {
    try {
      fn();
    } catch (error) {
      return error && error.code;
    }
    return null;
  };
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "remove_scene", index: 5 }])), "bad_op");
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "teleport" }])), "bad_op");
});

test("ProxyAiAdapter requires config and parses fenced JSON", async () => {
  const bare = new ProxyAiAdapter({});
  assert.equal(await codeOf(bare.resolveAuto({})), "proxy_not_configured");

  const stub = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(RESOLUTION) + "\n```" } }] }), {
      status: 200,
    });
  const ai = new ProxyAiAdapter({ proxyBase: "https://proxy.test", appToken: "tok", fetchImpl: stub });
  assert.deepEqual(await ai.resolveAuto({ prompt: "x", ratio: "9:16" }), RESOLUTION);

  const bad = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ code: "unauthorized", message: "no" }), { status: 401 }),
  });
  assert.equal(await codeOf(bad.resolveAuto({})), "unauthorized");

  const empty = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  });
  assert.equal(await codeOf(empty.resolveAuto({})), "provider_invalid_output");
});

test("runMotionJob happy path with state sequence", async () => {
  const job = createMotionJob(input());
  const seen = [];
  const adapters = fakeAdapters();
  await runMotionJob(job, adapters, (snapshot) => seen.push(snapshot.state));
  assert.equal(job.state, "done");
  assert.equal(job.progress, 1);
  assert.equal(job.result.plan.scenes.length, 1);
  assert.ok(job.result.plan.scenes[0].visual.doc_id.startsWith("doc/"), "content-addressed doc id");
  assert.equal(job.result.muxPending, true);
  assert.deepEqual(seen[0], "resolving");
  assert.ok(seen.includes("authoring"));
  assert.ok(seen.includes("rendering"));
  assert.equal(adapters.calls.renderer, 1);

  // Rerun hits the final cache only if a video was stored; without mux the
  // renderer runs again but the plan path is identical and deterministic.
  const again = createMotionJob(input());
  await runMotionJob(again, adapters, null);
  assert.equal(again.state, "done");
  assert.equal(
    again.result.plan.scenes[0].visual.doc_id,
    job.result.plan.scenes[0].visual.doc_id,
    "identical inputs share doc ids",
  );
});

test("runMotionJob caches final video on hit", async () => {
  const adapters = fakeAdapters();
  const first = createMotionJob(input());
  // Fake mux stores bytes so the second run short-circuits.
  adapters.mux = {
    mux: async () => new Uint8Array([1, 2, 3]),
  };
  await runMotionJob(first, adapters, null);
  assert.equal(first.state, "done");
  assert.equal(adapters.calls.renderer, 1);
  const second = createMotionJob(input());
  await runMotionJob(second, adapters, null);
  assert.equal(second.state, "done");
  assert.equal(second.result.cached, true);
  assert.equal(adapters.calls.renderer, 1, "renderer skipped on cache hit");
});

test("runMotionJob fails structured on AI error", async () => {
  const job = createMotionJob(input());
  const adapters = fakeAdapters({
    ai: {
      resolveAuto: async () => {
        const error = new Error("nope");
        error.code = "proxy_not_configured";
        throw error;
      },
      authorScene: async () => "",
      chatPatch: async () => [],
    },
  });
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "proxy_not_configured");
});

test("runMotionJob rejects empty prompt", async () => {
  const job = createMotionJob(input({ prompt: "   " }));
  await runMotionJob(job, fakeAdapters(), null);
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "bad_request");
});

test("runMotionJob honors basePlan without AI (chat re-render)", async () => {
  const adapters = fakeAdapters();
  const first = createMotionJob(input());
  await runMotionJob(first, adapters, null);
  assert.equal(first.state, "done");
  const resolvedCalls = adapters.calls.resolve;

  const patched = applyPatchOps(first.result.plan, [{ op: "set_seed", seed: 9 }]);
  const job = createMotionJob(input());
  job.basePlan = patched;
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "done");
  assert.equal(job.result.plan.seed, 9);
  assert.equal(adapters.calls.resolve, resolvedCalls, "no AI on re-render");
  assert.ok(job.result.plan.scenes[0].visual.doc_id, "doc ids preserved");
});
