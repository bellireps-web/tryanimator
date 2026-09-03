/**
 * Deterministic frame clock (pure, no DOM).
 * Frame n of a 30fps render happens exactly at t = n / fps.
 */

export const FPS = 30;

/** Seconds at frame n. */
export function timeAtFrame(n, fps = FPS) {
  return n / fps;
}

/** Total frames for a duration (rounds up partial frames). */
export function frameCount(durationSecs, fps = FPS) {
  return Math.max(1, Math.ceil(durationSecs * fps));
}

/**
 * Split a duration into render segments of at most maxFrames each.
 * Returns [{ index, startFrame, frameCount }]. Keeps peak memory bounded
 * for 60s renders (1800 frames max).
 */
export function segments(durationSecs, maxFrames, fps = FPS) {
  if (!(maxFrames >= 1)) throw structuredError("bad_segment", "maxFrames must be >= 1");
  const total = frameCount(durationSecs, fps);
  const out = [];
  let start = 0;
  let index = 0;
  while (start < total) {
    const count = Math.min(maxFrames, total - start);
    out.push({ index: index++, startFrame: start, frameCount: count });
    start += count;
  }
  return out;
}

/** Structured error (mirrors motion-core codes; never silent defaults). */
export function structuredError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
