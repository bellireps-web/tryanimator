import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPalette,
  buildResolvePrompt,
  buildScenePrompt,
  buildPatchPrompt,
  applyAutoResolution,
  applyResolvedScenes,
  googleFontUrl,
  brandCssVars,
  PROMPT_CHAR_CAP,
} from "./auto.js";

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error && error.code;
  }
  return null;
}

function solidBuffer(r, g, b, pixels = 16) {
  const data = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

test("extractPalette finds dominant colors", () => {
  // 4-bit buckets expand to centers: 0x70->0x77, 0x69->0x66, 0xAA->0xAA.
  assert.deepEqual(extractPalette(solidBuffer(0x70, 0x69, 0xaa), 3), ["#7766AA"]);
  // Transparent pixels are ignored.
  const data = solidBuffer(255, 0, 0, 8);
  for (let i = 8; i < 16; i++) data[i * 4 + 3] = 0;
  assert.deepEqual(extractPalette(data, 3), ["#FF0000"]);
  // Two colors come back ordered by frequency.
  const mixed = new Uint8Array(12 * 4);
  for (let i = 0; i < 12; i++) {
    const blue = i < 9;
    mixed[i * 4] = blue ? 0 : 255;
    mixed[i * 4 + 1] = 0;
    mixed[i * 4 + 2] = blue ? 255 : 0;
    mixed[i * 4 + 3] = 255;
  }
  assert.deepEqual(extractPalette(mixed, 2), ["#0000FF", "#FF0000"]);
  assert.equal(codeOf(() => extractPalette([1, 2, 3])), 'bad_pixels');
});

test("prompt builders cap and shape payloads", () => {
  const messages = buildResolvePrompt({
    prompt: "x".repeat(9000),
    ratio: "9:16",
    palette: ["#7069AA"],
    hasVideoReference: true,
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /muse|JSON only|duration_secs/);
  assert.ok(messages[1].content.length <= PROMPT_CHAR_CAP + 200);
  assert.match(messages[1].content, /video reference frames were sampled/);

  const scene = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    styleId: "kinetic-type",
    brand: { colors: ["#FFF"], font: "Figtree" },
  });
  assert.match(scene[0].content, /kinetic-type/);

  const patch = buildPatchPrompt('{"seed":1}', "make it longer");
  assert.match(patch[0].content, /patch ops/);
  assert.match(patch[1].content, /make it longer/);
});

test("applyAutoResolution validates and applies", () => {
  const plan = { duration: "auto", style: "auto", seed: 1 };
  const resolved = applyAutoResolution(plan, {
    duration_secs: 30,
    style_id: "kinetic-type",
    style_version: "1.0.0",
  });
  assert.equal(resolved.duration, 30);
  assert.deepEqual(resolved.style, { id: "kinetic-type", version: "1.0.0" });
  assert.equal(plan.duration, "auto", "input plan is not mutated");

  assert.equal(codeOf(() => applyAutoResolution(plan, { duration_secs: 61, style_id: "kinetic-type", style_version: "1.0.0" })), 'bad_resolution');
  assert.equal(codeOf(() => applyAutoResolution(plan, { duration_secs: 10, style_id: "nope", style_version: "1.0.0" })), 'unknown_preset');
  assert.equal(codeOf(() => applyAutoResolution(plan, null)), 'bad_resolution');
});

test("applyResolvedScenes validates sum and fields", () => {
  const plan = { duration: 30, scenes: [] };
  const scenes = [
    { duration_secs: 10, brief: "opening", text: "Hi", transition: "fade" },
    { duration_secs: 20, brief: "main", text: "", transition: "cut" },
  ];
  const resolved = applyResolvedScenes(plan, scenes);
  assert.equal(resolved.scenes.length, 2);
  assert.deepEqual(resolved.scenes[0].visual, { kind: "authored", doc_id: "" });
  const withVisual = applyResolvedScenes(plan, [
    { ...scenes[0], duration_secs: 10, visual: { kind: "stock", query: "  neon city " } },
    { ...scenes[1], duration_secs: 20, visual: { kind: "asset", id: "upload-1" } },
  ]);
  assert.deepEqual(withVisual.scenes[0].visual, { kind: "stock", query: "neon city" });
  assert.deepEqual(withVisual.scenes[1].visual, { kind: "asset", id: "upload-1" });
  assert.equal(
    codeOf(() =>
      applyResolvedScenes(plan, [{ ...scenes[0], visual: { kind: "teleport" } }, scenes[1]]),
    ),
    "bad_resolution",
  );
  assert.equal(
    codeOf(() =>
      applyResolvedScenes(plan, [{ ...scenes[0], visual: { kind: "stock", query: "  " } }, scenes[1]]),
    ),
    "bad_resolution",
  );
  assert.equal(codeOf(() => applyResolvedScenes(plan, [])), 'bad_resolution');
  assert.equal(codeOf(() => applyResolvedScenes(plan, [{ ...scenes[0], duration_secs: 5 }, scenes[1]])), 'bad_resolution');
  assert.equal(codeOf(() => applyResolvedScenes(plan, [{ ...scenes[0], brief: "  " }, scenes[1]])), 'bad_resolution');
});

test("brand font url and css vars", () => {
  assert.equal(
    googleFontUrl("IBM Plex Sans"),
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap",
  );
  assert.equal(codeOf(() => googleFontUrl("Evil<script>")), 'bad_font');
  const css = brandCssVars({ colors: ["#7069AA", "#1F1B46"], font: "Figtree" });
  assert.match(css, /--brand-0: #7069AA;/);
  assert.match(css, /--brand-1: #1F1B46;/);
  assert.match(css, /--brand-font: 'Figtree'/);
  assert.equal(codeOf(() => brandCssVars({ colors: [] })), 'bad_brand');
});
