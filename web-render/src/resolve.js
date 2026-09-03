/**
 * Pure scene resolver: (plan, t, dims) -> draw ops with absolute numbers.
 * No DOM, no canvas, no text measuring: everything downstream is a dumb
 * interpreter (see paint.js), so this file is fully testable in Node and
 * golden-testable frame by frame.
 *
 * Conventions:
 * - t in seconds, 0 <= t < total. Out of range is a structured error.
 * - The plan is assumed Rust-validated; violations found here still throw
 *   structured errors (never silent fallbacks).
 * - Blend window for transitions: last BLEND_SECS of a non-final scene.
 */

import { resolvePreset } from "./presets.js";
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
  return plan.brand.colors[index % plan.brand.colors.length];
}

function planPreset(plan) {
  if (plan.style === "auto" || (plan.style && plan.style.id === undefined)) {
    throw structuredError("style_unresolved", "resolve Auto style before rendering");
  }
  const record = resolvePreset(plan.style.id);
  if (record.version !== plan.style.version) {
    throw structuredError(
      "version_mismatch",
      `preset ${plan.style.id} pinned at ${plan.style.version}, harness has ${record.version}`,
    );
  }
  return record;
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
    // Full HTML docs need the vendored HyperFrames runtime (pending).
    return { op: "authored", doc_id: visual.doc_id };
  }
  throw structuredError("unknown_visual", `visual kind: ${visual.kind}`);
}

function sceneOps(plan, scene, sceneIndex, progress, dims, preset) {
  const { w, h } = dims;
  const font = plan.brand.font;
  const bg = brandColor(plan, sceneIndex);
  const ops = [{ op: "background", color: bg }, visualOp(scene, progress)];

  switch (preset.id) {
    case "kinetic-type": {
      const rise = (1 - easeOutCubic(Math.min(1, progress))) * 40;
      const alpha = Math.min(1, progress * 3);
      ops.push({
        op: "text",
        str: scene.text,
        x: w / 2,
        y: h / 2 - rise,
        size: Math.round(w * 0.11),
        font,
        align: "center",
        color: "#FFFFFF",
        alpha,
      });
      break;
    }
    case "count-up": {
      const value = Math.floor(easeInOutCubic(Math.min(1, Math.max(0, progress))) * 100);
      ops.push({
        op: "text",
        str: String(value),
        x: w / 2,
        y: h * 0.42,
        size: Math.round(w * 0.22),
        font,
        align: "center",
        color: "#FFFFFF",
        alpha: 1,
      });
      ops.push({
        op: "text",
        str: scene.text,
        x: w / 2,
        y: h * 0.58,
        size: Math.round(w * 0.07),
        font,
        align: "center",
        color: "#FFFFFF",
        alpha: 0.85,
      });
      break;
    }
    case "lower-third": {
      const bandH = h * 0.22;
      ops.push({
        op: "rect",
        x: 0,
        y: h - bandH,
        w,
        h: bandH,
        color: plan.brand.colors[(sceneIndex + 1) % plan.brand.colors.length],
        alpha: 1,
      });
      ops.push({
        op: "text",
        str: scene.text,
        x: w * 0.08,
        y: h - bandH / 2,
        size: Math.round(w * 0.075),
        font,
        align: "left",
        color: "#FFFFFF",
        alpha: 1,
      });
      break;
    }
    case "logo-sting": {
      const letter = (scene.text.trim()[0] || "•").toUpperCase();
      ops.push({
        op: "circle",
        x: w / 2,
        y: h / 2,
        r: 40 + 180 * progress,
        color: "#FFFFFF",
        alpha: Math.max(0, 0.6 * (1 - progress)),
      });
      ops.push({
        op: "text",
        str: letter,
        x: w / 2,
        y: h / 2,
        size: Math.round(w * 0.3),
        font,
        align: "center",
        color: "#FFFFFF",
        alpha: Math.min(1, progress * 2),
      });
      break;
    }
    default:
      throw structuredError("unknown_preset", `unhandled preset: ${preset.id}`);
  }
  return ops;
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
  const preset = planPreset(plan);
  if (next && timeLeft <= BLEND_SECS && scene.transition !== "cut") {
    const mix = 1 - timeLeft / BLEND_SECS;
    const under = sceneOps(plan, scene, index, 1, dims, preset);
    const over = sceneOps(plan, next, index + 1, 0, dims, preset);
    if (scene.transition !== "fade" && scene.transition !== "slide") {
      throw structuredError("unknown_transition", `transition: ${scene.transition}`);
    }
    return { ops: [{ op: "blend", mode: scene.transition, mix, under, over }] };
  }
  return { ops: sceneOps(plan, scene, index, progress, dims, preset) };
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
