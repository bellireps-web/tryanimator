/**
 * Browser entry points (Slice 2).
 * - renderFrame(plan, t, canvas, images): resolve + paint one frame.
 * - encodeSegment(...): VideoEncoder path; throws a structured error when
 *   WebCodecs is unavailable so callers show the spec's fallback cascade
 *   instead of failing silently.
 */
import { resolveFrame, sceneAt } from "./resolve.js";
import { paintOps } from "./paint.js";
import { containsAuthored, expandAuthoredOps, getSharedStage } from "./authored.js";
import { timeAtFrame, FPS } from "./clock.js";

export { resolveFrame, paintOps };
export { resolveAudio, sceneAt, planTotalSecs } from "./resolve.js";
export { segments, frameCount, timeAtFrame } from "./clock.js";

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

/**
 * Frame render with the authored HyperFrames runtime: `authored` ops are
 * executed (seeked DOM raster) before painting, so the frame carries the
 * real motion graphics. `docs` maps doc_id -> authored HTML.
 */
export function findFrameBackground(ops) {
  for (const op of ops || []) {
    if (!op) continue;
    if (op.op === "background") return op.color;
    if (op.op === "blend") return findFrameBackground(op.under) || findFrameBackground(op.over);
  }
  return "#060511";
}

export async function renderFrameAsync(plan, t, canvas, images, docs) {
  const dims = { w: canvas.width, h: canvas.height };
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const error = new Error("2d context unavailable");
    error.code = "no_2d_context";
    throw error;
  }
  const { ops } = resolveFrame(plan, t, dims);
  let finalOps = ops;
  if (containsAuthored(ops)) {
    if (!docs) {
      const error = new Error("authored docs unavailable for this frame");
      error.code = "authored_unavailable";
      throw error;
    }
    const { start, end } = sceneAt(plan, t);
    const progress = (t - start) / Math.max(1e-6, end - start);
    const stage = getSharedStage();
    finalOps = await expandAuthoredOps(ops, {
      getDoc: (id) => docs.get(id),
      render: ({ docId, html, progress: p }) =>
        stage.render({ docId, html, progress: p ?? progress, width: dims.w, height: dims.h, sceneSecs: end - start, bg: findFrameBackground(ops) }),
      images,
      width: dims.w,
      height: dims.h,
      progress,
    });
  }
  paintOps(ctx, finalOps, images);
  return finalOps;
}

function requireVideoEncoder() {
  if (typeof VideoEncoder === "undefined") {
    const error = new Error("VideoEncoder unavailable in this browser");
    error.code = "no_video_encoder";
    throw error;
  }
}

/**
 * Encode one segment of frames. Resolves with { chunks, keyframes,
 * decoderConfig } where each chunk carries serializable packet data
 * { data, type, timestamp, duration } for the segment cache and the
 * mediabunny mux. `docs` feeds the authored HyperFrames runtime.
 */
export async function encodeSegment(plan, segment, canvas, images, { docs, onProgress } = {}) {
  requireVideoEncoder();
  const chunks = [];
  let keyframes = 0;
  let codecError = null;
  let decoderConfig = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      // Mediabunny necesita decoderConfig (SPS/PPS) en el primer add().
      // Viene como 2º arg del output de WebCodecs; lo guardamos una vez.
      if (!decoderConfig && metadata && metadata.decoderConfig) {
        const dc = metadata.decoderConfig;
        let description = null;
        try {
          if (dc.description) {
            const src = dc.description instanceof ArrayBuffer ? new Uint8Array(dc.description) : new Uint8Array(dc.description);
            description = new Uint8Array(src);
          }
        } catch {
          description = null;
        }
        decoderConfig = {
          codec: dc.codec,
          codedWidth: dc.codedWidth,
          codedHeight: dc.codedHeight,
          description,
        };
      }
      // Copy bytes now: EncodedVideoChunk views are only valid while the
      // chunk lives, and the segment cache stores plain data (IndexedDB).
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        size: chunk.byteLength,
        key: chunk.type === "key",
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
      });
      if (chunk.type === "key") keyframes++;
      if (onProgress) onProgress(chunks.length);
    },
    error: (error) => {
      codecError = error;
    },
  });
  // 1080p30 necesita Level 4.0+ (el 3.0 solo da ~10M px/s y cierra el codec).
  encoder.configure({
    codec: "avc1.640028",
    width: canvas.width,
    height: canvas.height,
    bitrate: 8_000_000,
    framerate: FPS,
  });
  try {
    for (let i = 0; i < segment.frameCount; i++) {
      if (codecError) throw codecError;
      const n = segment.startFrame + i;
      await renderFrameAsync(plan, timeAtFrame(n, FPS), canvas, images, docs);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / FPS) });
      try {
        encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      } finally {
        frame.close();
      }
      // Let progress callbacks breathe every 30 frames.
      if (i % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await encoder.flush();
    if (codecError) throw codecError;
  } finally {
    try {
      encoder.close();
    } catch {
      // ya cerrado por el navegador tras error
    }
  }
  return { chunks, keyframes, decoderConfig };
}
