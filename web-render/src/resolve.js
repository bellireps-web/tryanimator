/**
 * Pure scene resolver: (plan, t, dims) -> draw ops with absolute numbers.
 * No DOM, no canvas, no text measuring: everything downstream is a dumb
 * interpreter (see paint.js), so this file is fully testable in Node and
 * golden-testable frame by frame.
 *
 * Free canvas: there are no preset styles. Every frame is the plan's
 * background plus the scene visual (stock/asset image, or an authored
 * HyperFrames doc executed by the authored runtime). All motion graphics
 * come from authored docs; this layer only composes them.
 *
 * Conventions:
 * - t in seconds, 0 <= t < total. Out of range is a structured error.
 * - The plan is assumed Rust-validated; violations found here still throw
 *   structured errors (never silent fallbacks).
 * - Blend window for transitions: last BLEND_SECS of a non-final scene.
 */

import { structuredError } from "./clock.js";

export const BLEND_SECS = 0.4;

export function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3);
}

export function easeInOutCubic(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export function planTotalSecs(plan) {
  return plan.scenes.reduce((sum, scene) => sum + scene.duration_secs, 0);
}

/** Index of the scene playing at t, plus its local [start, end) range. */
export function sceneAt(plan, t) {
  if (!Number.isFinite(t) || t < 0 || t >= planTotalSecs(plan)) {
    throw structuredError("time_out_of_range", `t=${t} outside plan length`);
  }
  let start = 0;
  for (let index = 0; index < plan.scenes.length; index++) {
    const end = start + plan.scenes[index].duration_secs;
    if (t < end || index === plan.scenes.length - 1) {
      return { index, start, end };
    }
    start = end;
  }
  throw structuredError("time_out_of_range", `t=${t} outside plan length`);
}

function brandColor(plan, index) {
  const colors = (plan.brand && plan.brand.colors) || [];
  if (!colors.length) return "#060511";
  return colors[index % colors.length];
}

function visualOp(scene, progress) {
  const visual = scene.visual || {};
  if (visual.kind === "asset" || visual.kind === "stock") {
    return {
      op: "image",
      ref: visual.kind === "asset" ? visual.id : `stock:${visual.query}`,
      zoom: 1 + 0.08 * progress,
      alpha: 1,
    };
  }
  if (visual.kind === "authored") {
    // Executed by the authored HyperFrames runtime before painting.
    return { op: "authored", doc_id: visual.doc_id };
  }
  throw structuredError("unknown_visual", `visual kind: ${visual.kind}`);
}

function sceneOps(plan, scene, sceneIndex, progress) {
  // Free canvas: background + visual only. All motion graphics live in the
  // scene's authored HyperFrames doc; no preset overlays are painted.
  return [{ op: "background", color: brandColor(plan, sceneIndex) }, visualOp(scene, progress)];
}

/**
 * Resolve one frame. Returns { ops } where ops may contain a single
 * blend group during transitions: { op:'blend', mode, mix, under, over }.
 */
export function resolveFrame(plan, t, dims) {
  const { index, start, end } = sceneAt(plan, t);
  const scene = plan.scenes[index];
  const progress = (t - start) / (end - start);

  const timeLeft = end - t;
  const next = plan.scenes[index + 1];
  if (next && timeLeft <= BLEND_SECS && scene.transition !== "cut") {
    const mix = 1 - timeLeft / BLEND_SECS;
    const under = sceneOps(plan, scene, index, 1);
    const over = sceneOps(plan, next, index + 1, 0);
    if (scene.transition !== "fade" && scene.transition !== "slide") {
      throw structuredError("unknown_transition", `transition: ${scene.transition}`);
    }
    return { ops: [{ op: "blend", mode: scene.transition, mix, under, over }] };
  }
  return { ops: sceneOps(plan, scene, index, progress) };
}

/**
 * Pure audio timeline: music bed from 0 plus sfx cues.
 * Validation belongs to Rust; this only maps validated data.
 */
export function resolveAudio(plan) {
  const cues = [];
  if (plan.audio.music_track_id) {
    cues.push({ kind: "music", id: plan.audio.music_track_id, at_secs: 0 });
  }
  for (const sfx of plan.audio.sfx) {
    cues.push({ kind: "sfx", id: sfx.id, at_secs: sfx.at_secs });
  }
  return cues;
}
