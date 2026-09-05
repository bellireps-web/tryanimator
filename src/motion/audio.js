/**
 * Audio for Motion plans (Slice 5): licensed music + SFX via the proxy.
 *
 * - fetchTracks/fetchSfx: thin clients over GET /audio/music|/sfx.
 *   Errors propagate structured ({code, message}); nothing is defaulted.
 * - buildAudioTimeline(plan, library): pure schedule assembly used by the
 *   muxer. Validates bounds (mirrors Rust rules) and missing tracks.
 * - renderAudioBuffer: browser-only OfflineAudioContext mix (pending run).
 */

export function proxyError(status, body) {
  const error = new Error((body && body.message) || `audio provider error ${status}`);
  error.code = (body && body.code) || "provider_transport";
  error.status = status;
  return error;
}

async function getJson(url, fetchImpl = (...args) => fetch(...args)) {
  const response = await fetchImpl(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw proxyError(response.status, { code: "provider_transport", message: "invalid JSON" });
  }
  if (!response.ok) throw proxyError(response.status, body);
  return body;
}

/** Search music tracks by mood. Returns [{id, url, license}]. */
export async function fetchTracks(proxyBase, appToken, mood, fetchImpl = (...args) => fetch(...args)) {
  if (!mood || !mood.trim()) throw codedError("bad_request", "mood is required");
  const body = await getJson(
    `${proxyBase}/audio/music?mood=${encodeURIComponent(mood.trim())}`,
    (url) => fetchImpl(url, { headers: { "x-app-token": appToken } }),
  );
  return trackList(body);
}

/** Search SFX by name. Returns [{id, url, license}]. */
export async function fetchSfx(proxyBase, appToken, name, fetchImpl = (...args) => fetch(...args)) {
  if (!name || !name.trim()) throw codedError("bad_request", "name is required");
  const body = await getJson(
    `${proxyBase}/audio/sfx?name=${encodeURIComponent(name.trim())}`,
    (url) => fetchImpl(url, { headers: { "x-app-token": appToken } }),
  );
  return trackList(body);
}

function trackList(body) {
  if (!body || !Array.isArray(body.items)) {
    throw proxyError(502, { code: "provider_transport", message: "malformed audio payload" });
  }
  return body.items.map((item) => ({
    id: String(item.id || ""),
    url: String(item.url || ""),
    license: String(item.license || "unknown"),
  }));
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function planTotal(plan) {
  return plan.scenes.reduce((sum, scene) => sum + scene.duration_secs, 0);
}

/**
 * Assemble the mix schedule: [{id, url, at_secs, kind}].
 * library: { music: [{id,url}], sfx: [{id,url}] } (already fetched).
 */
export function buildAudioTimeline(plan, library) {
  const total = planTotal(plan);
  const schedule = [];
  if (plan.audio.music_track_id) {
    const track = (library.music || []).find((item) => item.id === plan.audio.music_track_id);
    if (!track) throw codedError("missing_track", `music track not fetched: ${plan.audio.music_track_id}`);
    schedule.push({ kind: "music", id: track.id, url: track.url, at_secs: 0 });
  }
  for (const cue of plan.audio.sfx || []) {
    const sfx = (library.sfx || []).find((item) => item.id === cue.id);
    if (!sfx) throw codedError("missing_track", `sfx not fetched: ${cue.id}`);
    if (!Number.isFinite(cue.at_secs) || cue.at_secs < 0 || cue.at_secs > total) {
      throw codedError("cue_out_of_range", `sfx ${cue.id} lands outside the plan`);
    }
    schedule.push({ kind: "sfx", id: sfx.id, url: sfx.url, at_secs: cue.at_secs });
  }
  return schedule;
}

/**
 * Mix a schedule into one AudioBuffer (browser-only, pending real run).
 * Fetching + decoding happen here; offsets come from buildAudioTimeline.
 */
export async function renderAudioBuffer(schedule, totalSecs, sampleRate = 44100) {
  if (typeof OfflineAudioContext === "undefined") {
    throw codedError("no_webaudio", "OfflineAudioContext unavailable");
  }
  const context = new OfflineAudioContext(2, Math.ceil(totalSecs * sampleRate), sampleRate);
  for (const entry of schedule) {
    const response = await fetch(entry.url);
    if (!response.ok) throw codedError("fetch_failed", `could not fetch ${entry.id}`);
    const data = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(entry.at_secs);
  }
  return context.startRendering();
}
