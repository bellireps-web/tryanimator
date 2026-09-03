import test from "node:test";
import assert from "node:assert/strict";
import { timeAtFrame, frameCount, segments } from "../src/clock.js";
import { resolvePreset, presetIds } from "../src/presets.js";
import {
  sceneAt,
  planTotalSecs,
  resolveFrame,
  resolveAudio,
  easeOutCubic,
  BLEND_SECS,
} from "../src/resolve.js";

function samplePlan(overrides = {}) {
  return {
    version: 1,
    ratio: "9:16",
    height: 1080,
    fps: 30,
    duration: 30,
    style: { id: "kinetic-type", version: "1.0.0" },
    brand: { colors: ["#7069AA", "#1F1B46"], font: "Figtree" },
    audio: { music_track_id: "m1", sfx: [{ id: "s1", at_secs: 5 }] },
    scenes: [
      { duration_secs: 10, visual: { kind: "stock", query: "neon" }, text: "Hello", transition: "fade" },
      { duration_secs: 20, visual: { kind: "asset", id: "a1" }, text: "World", transition: "cut" },
    ],
    seed: 7,
    ...overrides,
  };
}

const DIMS = { w: 608, h: 1080 };

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error && error.code;
  }
  return null;
}

test("clock: frame math and segments", () => {
  assert.equal(timeAtFrame(30), 1);
  assert.equal(frameCount(60), 1800);
  assert.equal(frameCount(0.05), 2);
  const segs = segments(60, 600);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], { index: 0, startFrame: 0, frameCount: 600 });
  assert.equal(segs[2].startFrame + segs[2].frameCount, 1800);
  assert.equal(codeOf(() => segments(10, 0)), 'bad_segment');
});

test("sceneAt: boundaries and range errors", () => {
  const plan = samplePlan();
  assert.equal(planTotalSecs(plan), 30);
  assert.deepEqual(sceneAt(plan, 0), { index: 0, start: 0, end: 10 });
  assert.deepEqual(sceneAt(plan, 9.999).index, 0);
  assert.deepEqual(sceneAt(plan, 10), { index: 1, start: 10, end: 30 });
  assert.equal(codeOf(() => sceneAt(plan, -1)), 'time_out_of_range');
  assert.equal(codeOf(() => sceneAt(plan, 30)), 'time_out_of_range');
});

test("resolveFrame: kinetic ops and brand cycling", () => {
  const plan = samplePlan();
  const { ops } = resolveFrame(plan, 5, DIMS);
  assert.deepEqual(ops[0], { op: "background", color: "#7069AA" });
  assert.equal(ops[1].op, "image");
  assert.equal(ops[1].ref, "stock:neon");
  assert.ok(ops[1].zoom > 1 && ops[1].zoom <= 1.08);
  const text = ops.find((op) => op.op === "text");
  assert.equal(text.str, "Hello");
  assert.equal(text.x, DIMS.w / 2);

  const second = resolveFrame(plan, 15, DIMS).ops;
  assert.equal(second[0].color, "#1F1B46");
  assert.equal(second[1].ref, "a1");
});

test("resolveFrame: fade blend group near boundary", () => {
  const plan = samplePlan();
  const t = 10 - BLEND_SECS / 2;
  const { ops } = resolveFrame(plan, t, DIMS);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "blend");
  assert.equal(ops[0].mode, "fade");
  assert.ok(Math.abs(ops[0].mix - 0.5) < 1e-9);
  // No blend outside the window.
  assert.ok(resolveFrame(plan, 10 - BLEND_SECS - 0.01, DIMS).ops[0].op !== "blend");
});

test("resolveFrame: slide blend and cut passthrough", () => {
  const plan = samplePlan();
  plan.scenes[0].transition = "slide";
  const { ops } = resolveFrame(plan, 9.9, DIMS);
  assert.equal(ops[0].mode, "slide");

  plan.scenes[0].transition = "cut";
  assert.ok(resolveFrame(plan, 9.9, DIMS).ops[0].op !== "blend");

  plan.scenes[0].transition = "spin";
  assert.equal(codeOf(() => resolveFrame(plan, 9.9, DIMS)), 'unknown_transition');
});

test("resolveFrame: style contract errors", () => {
  const auto = samplePlan({ style: "auto" });
  assert.equal(codeOf(() => resolveFrame(auto, 1, DIMS)), 'style_unresolved');

  const pinned = samplePlan({ style: { id: "kinetic-type", version: "9.9.9" } });
  assert.equal(codeOf(() => resolveFrame(pinned, 1, DIMS)), 'version_mismatch');

  const unknown = samplePlan({ style: { id: "nope", version: "1.0.0" } });
  assert.equal(codeOf(() => resolveFrame(unknown, 1, DIMS)), 'unknown_preset');
  assert.equal(codeOf(() => resolvePreset("nope")), 'unknown_preset');
  assert.deepEqual(presetIds(), ["kinetic-type", "count-up", "lower-third", "logo-sting"]);
});

test("resolveFrame: count-up is deterministic", () => {
  const plan = samplePlan({ style: { id: "count-up", version: "1.0.0" } });
  const first = resolveFrame(plan, 2, DIMS).ops;
  const again = resolveFrame(plan, 2, DIMS).ops;
  assert.deepEqual(first, again);
  const mid = resolveFrame(plan, 5, DIMS).ops.find(
    (op) => op.op === "text" && op.y === DIMS.h * 0.42,
  );
  assert.equal(mid.str, "50");
});

test("resolveFrame: logo-sting letter and lower-third band", () => {
  const sting = samplePlan({ style: { id: "logo-sting", version: "1.0.0" } });
  const letter = resolveFrame(sting, 5, DIMS).ops.find(
    (op) => op.op === "text" && op.size === Math.round(DIMS.w * 0.3),
  );
  assert.equal(letter.str, "H");

  const third = samplePlan({ style: { id: "lower-third", version: "1.0.0" } });
  const band = resolveFrame(third, 5, DIMS).ops.find((op) => op.op === "rect");
  assert.equal(band.h, DIMS.h * 0.22);
});

test("resolveFrame: unknown visual kind throws", () => {
  const plan = samplePlan();
  plan.scenes[0].visual = { kind: "teleport" };
  assert.equal(codeOf(() => resolveFrame(plan, 1, DIMS)), 'unknown_visual');
});

test("resolveFrame: authored op is explicit", () => {
  const plan = samplePlan();
  plan.scenes[0].visual = { kind: "authored", doc_id: "doc-9" };
  const { ops } = resolveFrame(plan, 1, DIMS);
  assert.deepEqual(ops[1], { op: "authored", doc_id: "doc-9" });
});

test("resolveAudio maps bed plus cues", () => {
  assert.deepEqual(resolveAudio(samplePlan()), [
    { kind: "music", id: "m1", at_secs: 0 },
    { kind: "sfx", id: "s1", at_secs: 5 },
  ]);
});

test("easing stays within [0,1]", () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(easeOutCubic(p) >= 0 && easeOutCubic(p) <= 1);
  }
  assert.equal(easeOutCubic(1), 1);
});
