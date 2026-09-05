import test from "node:test";
import assert from "node:assert/strict";
import { timeAtFrame, frameCount, segments } from "../src/clock.js";
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
    style: "free",
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

test("resolveFrame: free canvas is background plus visual only", () => {
  const plan = samplePlan();
  const { ops } = resolveFrame(plan, 5, DIMS);
  assert.deepEqual(ops[0], { op: "background", color: "#7069AA" });
  assert.equal(ops[1].op, "image");
  assert.equal(ops[1].ref, "stock:neon");
  assert.ok(ops[1].zoom > 1 && ops[1].zoom <= 1.08);
  assert.equal(ops.length, 2, "no preset overlays on a free canvas");

  const second = resolveFrame(plan, 15, DIMS).ops;
  assert.equal(second[0].color, "#1F1B46");
  assert.equal(second[1].ref, "a1");
});

test("resolveFrame: style field is ignored (free canvas)", () => {
  const plan = samplePlan();
  for (const style of ["free", "auto", { id: "anything" }, null]) {
    const { ops } = resolveFrame(samplePlan({ style }), 5, DIMS);
    assert.equal(ops[0].op, "background");
  }
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

test("resolveFrame: free canvas is deterministic", () => {
  const plan = samplePlan();
  const first = resolveFrame(plan, 2, DIMS).ops;
  const again = resolveFrame(plan, 2, DIMS).ops;
  assert.deepEqual(first, again);
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
