import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPalette,
  buildResolvePrompt,
  buildResolveRespond,
  buildScenePrompt,
  buildPatchPrompt,
  buildPatchRespond,
  threadHistoryForAgent,
  wantsDurationChange,
  filterUnaskedDurationOps,
  applyAutoResolution,
  applyResolvedScenes,
  wantsMultipleScenes,
  mergeScenesToOne,
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
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /muse|JSON only|duration_secs/);
  assert.ok(messages[1].content.length <= PROMPT_CHAR_CAP + 300);
  // References travel as image parts only: no steering text about them.
  assert.doesNotMatch(messages[1].content, /reference/i);
  assert.doesNotMatch(messages[1].content, /palette/i);

  const timedResolve = buildResolvePrompt({ prompt: "promo", ratio: "9:16", duration: 5 });
  assert.match(timedResolve[1].content, /target duration_secs: 5/);
  assert.doesNotMatch(timedResolve[1].content, /reference/i);

  const scene = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    brand: { colors: ["#FFF"], font: "Figtree" },
  });
  assert.match(scene[0].content, /blank canvas/);

  const timed = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    brand: { colors: ["#FFF"], font: "Figtree" },
    sceneDuration: 5,
  });
  assert.match(timed[0].content, /exactly 5s/);
  assert.match(timed[0].content, /ONE master gsap timeline/);
  assert.match(timed[0].content, /Animate EVERYTHING from the very first frame/);
  assert.match(timed[0].content, /STEP BY STEP/);
  assert.match(timed[0].content, /At time 0 almost nothing is visible/);
  assert.match(timed[0].content, /build-up completes in the first half/);
  assert.match(timed[0].content, /By 40% of the duration every element must already/);

  const vertical = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    brand: { colors: ["#FFF"], font: "Figtree" },
    sceneDuration: 5,
    ratio: "9:16",
  });
  assert.match(vertical[0].content, /vertical 9:16/);
  assert.match(vertical[1].content, /ratio: 9:16/);

  const patch = buildPatchPrompt('{"seed":1}', "make it longer");
  assert.match(patch[0].content, /patch ops/);
  assert.match(patch[0].content, /update_scene/);
  assert.match(patch[0].content, /brief/);
  assert.match(patch[1].content, /make it longer/);

  const respond = buildPatchRespond('{"seed":1}', "hazlo rojo");
  assert.match(respond.instructions, /"message"/);
  assert.match(respond.instructions, /never as prose/);
  assert.match(respond.instructions, /Only emit set_duration_secs/);
  assert.match(respond.input, /hazlo rojo/);
  assert.doesNotMatch(respond.input, /conversation so far/);

  const withHistory = buildPatchRespond('{"seed":1}', "más rayos", "user: tormenta\nassistant: Listo.");
  assert.match(withHistory.input, /conversation so far/);
  assert.match(withHistory.input, /user: tormenta/);
});

test("buildResolveRespond splits instructions from input", () => {
  const { instructions, input } = buildResolveRespond({ prompt: "promo", ratio: "9:16", duration: 5 });
  assert.match(instructions, /Free canvas/);
  assert.match(instructions, /JSON only/);
  assert.match(input, /target duration_secs: 5/);
  assert.doesNotMatch(input, /Free canvas/);
});

test("threadHistoryForAgent compacts the thread without duplicating", () => {
  const msgs = [
    { kind: "user", text: "faro en tormenta" },
    { kind: "ai", text: "Listo, tormenta intensa.", trace: "v2 · 1 escena" },
    { kind: "ctx", text: "Motion: 1 escenas" },
    { kind: "user", text: "más rayos" },
  ];
  const history = threadHistoryForAgent(msgs, "más rayos");
  assert.ok(!history.includes("más rayos"), "current turn travels separately");
  assert.match(history, /user: faro en tormenta/);
  assert.match(history, /assistant: Listo, tormenta intensa/);
  assert.ok(!history.includes("Motion: 1"), "ctx lines are skipped");
  assert.equal(threadHistoryForAgent([], "hola"), "");
  const long = threadHistoryForAgent([{ kind: "user", text: "x".repeat(5000) }, { kind: "user", text: "fin" }], "fin");
  assert.ok(long.length <= 3000);
});

test("buildScenePrompt carries revision and currentDoc", () => {
  const revised = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    brand: { colors: ["#FFF"], font: "Figtree" },
    revision: "quitale el neon",
  });
  assert.match(revised[1].content, /user revision.*quitale el neon/);
  const plain = buildScenePrompt({ prompt: "promo", sceneBrief: "opening", brand: {} });
  assert.doesNotMatch(plain[1].content, /user revision/);

  const editing = buildScenePrompt({
    prompt: "promo",
    sceneBrief: "opening",
    brand: {},
    revision: "quitale el neon",
    currentDoc: "<div>old</div>",
  });
  assert.match(editing[0].content, /smallest possible change/);
  assert.match(editing[1].content, /EDIT THIS ONE/);
  assert.match(editing[1].content, /<div>old<\/div>/);
});

test("applyAutoResolution validates duration and frees the canvas", () => {
  const plan = { duration: "auto", style: "auto", seed: 1 };
  const resolved = applyAutoResolution(plan, { duration_secs: 30 });
  assert.equal(resolved.duration, 30);
  assert.equal(resolved.style, "free");
  assert.equal(plan.duration, "auto", "input plan is not mutated");
  // Legacy style_* fields are ignored, never validated.
  const legacy = applyAutoResolution(plan, { duration_secs: 10, style_id: "kinetic-type", style_version: "1.0.0" });
  assert.equal(legacy.style, "free");

  assert.equal(codeOf(() => applyAutoResolution(plan, { duration_secs: 61 })), 'bad_resolution');
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

test("duration lock: only when explicitly asked", () => {
  assert.equal(wantsDurationChange("hazlo de 8 segundos"), true);
  assert.equal(wantsDurationChange("cámbialo a 10s"), true);
  assert.equal(wantsDurationChange("qué duración tiene"), true);
  assert.equal(wantsDurationChange("quitale el neon"), false);
  assert.equal(wantsDurationChange(""), false);
  const ops = [{ op: "set_duration_secs", secs: 10 }, { op: "set_seed", seed: 1 }];
  assert.deepEqual(filterUnaskedDurationOps(ops, "quitale el neon"), [{ op: "set_seed", seed: 1 }]);
  assert.deepEqual(filterUnaskedDurationOps(ops, "hazlo de 8 segundos"), ops);
  assert.equal(filterUnaskedDurationOps(null, "x"), null);
});

test("single scene by default, merge backstop, explicit multi", () => {
  assert.equal(wantsMultipleScenes("haz un video"), false);
  assert.equal(wantsMultipleScenes("dos escenas: apertura y cierre"), true);
  assert.equal(wantsMultipleScenes("a 3-part story with chapters"), true);
  assert.equal(wantsMultipleScenes("varias escenas por favor"), true);
  assert.equal(wantsMultipleScenes("multiple scenes please"), true);
  assert.equal(wantsMultipleScenes(""), false);

  const merged = mergeScenesToOne([
    { duration_secs: 2, brief: "open", text: "Hi", transition: "fade", visual: { kind: "stock", query: "neon" } },
    { duration_secs: 3, brief: "close", text: "Bye", transition: "cut" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].duration_secs, 5);
  assert.match(merged[0].brief, /open/);
  assert.match(merged[0].brief, /close/);
  assert.equal(merged[0].transition, "fade");
  assert.deepEqual(merged[0].visual, { kind: "stock", query: "neon" });
  assert.deepEqual(mergeScenesToOne([]), []);
  assert.equal(mergeScenesToOne([{ duration_secs: 5 }]).length, 1);

  const sys = buildResolvePrompt({ prompt: "x", ratio: "9:16" })[0].content;
  assert.match(sys, /exactly ONE scene/);
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
