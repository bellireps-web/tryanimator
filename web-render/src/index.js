/**
 * Browser entry points (Slice 2).
 * - renderFrame(plan, t, canvas, images): resolve + paint one frame.
 * - encodeSegment(...): VideoEncoder path; throws a structured error when
 *   WebCodecs is unavailable so callers show the spec's fallback cascade
 *   instead of failing silently.
 */
import { resolveFrame } from "./resolve.js";
import { paintOps } from "./paint.js";
import { timeAtFrame, FPS } from "./clock.js";

export { resolveFrame, paintOps };
export { resolveAudio, sceneAt, planTotalSecs } from "./resolve.js";
export { segments, frameCount, timeAtFrame } from "./clock.js";
export { PRESETS, resolvePreset, presetIds } from "./presets.js";

export function renderFrame(plan, t, canvas, images) {
  const dims = { w: canvas.width, h: canvas.height };
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const error = new Error("2d context unavailable");
    error.code = "no_2d_context";
    throw error;
  }
  const { ops } = resolveFrame(plan, t, dims);
  paintOps(ctx, ops, images);
  return ops;
}

function requireVideoEncoder() {
  if (typeof VideoEncoder === "undefined") {
    const error = new Error("VideoEncoder unavailable in this browser");
    error.code = "no_video_encoder";
    throw error;
  }
}

/**
 * Encode one segment of frames. Resolves with { chunks, keyframes }.
 * The caller muxes (mediabunny, pending vendoring) — this proves the
 * encode path frame by frame.
 */
export async function encodeSegment(plan, segment, canvas, images, onProgress) {
  requireVideoEncoder();
  const chunks = [];
  let keyframes = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      chunks.push({ size: chunk.byteLength, key: chunk.type === "key" });
      if (chunk.type === "key") keyframes++;
      if (onProgress) onProgress(chunks.length);
    },
    error: (error) => {
      throw error;
    },
  });
  encoder.configure({
    codec: "avc1.42E01E",
    width: canvas.width,
    height: canvas.height,
    bitrate: 8_000_000,
    framerate: FPS,
  });
  for (let i = 0; i < segment.frameCount; i++) {
    const n = segment.startFrame + i;
    renderFrame(plan, timeAtFrame(n, FPS), canvas, images);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / FPS) });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    // Let progress callbacks breathe every 30 frames.
    if (i % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await encoder.flush();
  encoder.close();
  return { chunks, keyframes };
}
