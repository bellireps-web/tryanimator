/**
 * Auto duration resolution + brand plumbing (Slice 4). Free canvas: there
 * are no preset styles, so resolution only decides duration and scenes.
 *
 * Split by testability:
 * - PURE (tested here): palette extraction from pixels, prompt builders
 *   with caps, resolution applier with validation, Google Fonts URL and
 *   CSS variables.
 * - LIVE (needs proxy + key): sending the prompts, sampling video frames
 *   in the browser. Kept thin and marked; no logic hides there.
 */
export const PROMPT_CHAR_CAP = 4000;
export const MOTION_MODEL = "muse-spark-1.3";

/** Quantize RGBA pixels to 4 bits/channel and return top hex colors. */
export function extractPalette(pixels, maxColors = 5) {
  if (!(pixels instanceof Uint8Array) || pixels.length % 4 !== 0) {
    throw codedError("bad_pixels", "expected Uint8Array RGBA pixels");
  }
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue; // skip transparent
    const key = (pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, maxColors))
    .map(([key]) => {
      const r = ((key >> 8) & 0xf) * 17;
      const g = ((key >> 4) & 0xf) * 17;
      const b = (key & 0xf) * 17;
      return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    });
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clip(text, cap) {
  const str = String(text || "");
  return str.length > cap ? str.slice(0, cap) : str;
}

const RESOLVE_SYSTEM = [
  "You resolve Auto fields of a MotionPlan v1 for a 1080p30 HyperFrames render.",
  "Free canvas: there are no preset styles. Every scene is a blank canvas for",
  "a full-bleed authored HyperFrames document (HTML+GSAP).",
  "Return exactly ONE scene covering the full duration, unless the user",
  "explicitly asks for multiple scenes, chapters or parts.",
  "Reply with JSON only: {\"duration_secs\": 1..60,",
  " \"scenes\": [{\"duration_secs\": N, \"brief\": \"...\", \"text\": \"...\", \"transition\": \"cut|fade|slide\"}]}.",
  "Scene durations must sum to duration_secs. Never invent other fields.",
  "Optional per scene: \"visual\": {\"kind\": \"stock\", \"query\": \"...\"} for a photographic",
  "backdrop (a short search query). Omit visual for authored graphic scenes.",
].join(" ");

/**
 * True when the user explicitly asks for a different duration.
 * Pure: backstop so patches never resize the video unasked.
 */
export function wantsDurationChange(text) {
  return /\b\d+\s*(s|seg|segs|segundos?)\b|duraci[óo]n|duration/i.test(String(text || ""));
}

/**
 * Drop set_duration_secs ops the user did not ask for. Pure.
 */
export function filterUnaskedDurationOps(ops, text) {
  if (!Array.isArray(ops) || wantsDurationChange(text)) return ops;
  return ops.filter((op) => !op || op.op !== "set_duration_secs");
}

/**
 * True when the user explicitly asks for several scenes/chapters/parts.
 * Pure: the backstop for the single-scene default.
 */
export function wantsMultipleScenes(text) {
  return /\b(\d+[\s-]*(escenas?|scenes?|parts?|partes|cap[ií]tulos?|chapters?)|varias?\s+escenas?|multiple\s+scenes?|several\s+scenes?|dos\s+escenas?|tres\s+escenas?|two\s+scenes?|three\s+scenes?|cap[ií]tulos|chapters)\b/i.test(
    String(text || ""),
  );
}

/**
 * Merge a scene list into a single scene (durations add up, briefs/texts
 * join, first transition and first usable visual win). Pure backstop so one
 * stray multi-scene answer never splits the video.
 */
export function mergeScenesToOne(scenes) {
  const list = (scenes || []).filter(Boolean);
  if (list.length <= 1) return list.slice();
  const duration_secs = list.reduce((sum, scene) => sum + (Number(scene.duration_secs) || 0), 0);
  const firstVisual = list.find((scene) => scene.visual && typeof scene.visual === "object");
  const merged = {
    duration_secs,
    brief: list.map((scene) => String(scene.brief || "")).filter(Boolean).join("; "),
    text: list.map((scene) => String(scene.text || "")).filter(Boolean).join(" "),
    transition: String(list[0].transition || "cut"),
  };
  if (firstVisual) merged.visual = firstVisual.visual;
  return [merged];
}

/** Messages for POST /ai/chat to resolve Auto duration + scenes. Reference
 *  images travel as multimodal parts with no steering text: the model sees
 *  them, nothing tells it what to do with them. */
export function buildResolvePrompt({ prompt, ratio, duration = "auto", sceneCount }) {
  const lines = [
    `prompt: ${clip(prompt, PROMPT_CHAR_CAP)}`,
    `ratio: ${ratio}`,
  ];
  if (Number.isFinite(duration) && duration >= 1 && duration <= 60) {
    lines.push(`target duration_secs: ${Math.round(duration)} (you must return duration_secs=${Math.round(duration)} and scenes must sum exactly to it)`);
  } else {
    lines.push("target duration_secs: auto (pick 1..60 and make scenes sum to it)");
  }
  const count = Math.floor(Number(sceneCount));
  if (Number.isFinite(count) && count >= 1) {
    lines.push(`target scenes: exactly ${count} scene brief(s) (explicit user choice, overrides the single-scene default; durations must still sum to duration_secs)`);
  }
  return [
    { role: "system", content: RESOLVE_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Instructions+input for POST /ai/respond to resolve Auto duration + scenes. */
export function buildResolveRespond({ prompt, ratio, duration = "auto", sceneCount }) {
  const [, user] = buildResolvePrompt({ prompt, ratio, duration, sceneCount });
  return { instructions: RESOLVE_SYSTEM, input: user.content };
}

/** Messages for POST /ai/chat to author one HyperFrames scene document. */
export function buildScenePrompt({ prompt, sceneBrief, brand, sceneDuration, ratio, revision, currentDoc }) {
  const secs = Number.isFinite(Number(sceneDuration))
    ? Math.min(60, Math.max(1, Math.round(Number(sceneDuration))))
    : null;
  const vertical = String(ratio || "").startsWith("9:");
  return [
    {
      role: "system",
      content:
        `Author one deterministic HyperFrames scene (HTML+GSAP) on a blank canvas. Reply with the document only, no prose. ` +
        "Rules: build ONE master gsap timeline" +
        (secs ? ` covering exactly ${secs}s` : "") +
        ", with VISIBLE motion from the first to the last second (no static holds: " +
        "stagger entrances, loops and counters across the whole timeline, never front-load " +
        "everything and freeze); start it paused (the runner seeks it by fraction); no random, " +
        "Date, or fetch; no external scripts (gsap and fonts are provided); all CSS inline in <style>. " +
        "Animate EVERYTHING from the very first frame: every text, object, shape, bar, dot, badge and background " +
        "layer gets its own tween (entrance + ambient motion) — nothing may appear static or pop in without animation. " +
        "Build the scene STEP BY STEP in clearly separated parts: first the title animates in alone, then the second " +
        "element, then the next, each with its own staggered entrance window — never reveal everything at once. " +
        "Pacing: the build-up completes in the first half (title inside the first second); the second half keeps " +
        "everything alive with ambient motion and counters. By 40% of the duration every element must already " +
        "be visible — no element waits until the second half to appear. " +
        "At time 0 almost nothing is visible except the background: every element must start hidden and enter later. " +
        (currentDoc
          ? "A CURRENT document is provided below: edit THAT document with the smallest possible change — keep layout, palette, structure and every unrelated element; change ONLY what the revision requires. "
          : "") +
        (vertical
          ? "Layout is vertical 9:16: stack content top-to-bottom, huge type (no wide 16:9 frames, no min-widths above 520px, no side-by-side columns)."
          : "Layout is horizontal: you may use wide frames and side-by-side columns.") +
        " Full-bleed is mandatory: html and body are exactly the frame size — root content must span the FULL width and FULL height (no max-width wrappers, no centered narrow frames, no empty margins); every pixel must be intentional background or content.",
    },
    {
      role: "user",
      content: [
        `video: ${clip(prompt, PROMPT_CHAR_CAP)}`,
        `scene: ${clip(sceneBrief, 1000)}`,
        `brand colors: ${(brand.colors || []).join(", ")}; font: ${brand.font || "Figtree"}`,
        `ratio: ${ratio || "9:16"}`,
        ...(revision ? [`user revision (must be visible in the rebuild): ${clip(revision, 500)}`] : []),
        ...(currentDoc ? [`current document (EDIT THIS ONE — minimal changes only):\n${clip(currentDoc, 12000)}`] : []),
      ].join("\n"),
    },
  ];
}

const PATCH_OPS_LIST =
  '{"op":"set_duration_secs","secs":N},' +
  '{"op":"set_brand","colors":[],"font":""},' +
  '{"op":"update_scene","index":N,"text":"...","brief":"...","duration_secs":N},{"op":"add_scene","index":N},{"op":"remove_scene","index":N},' +
  '{"op":"set_music_track","track_id":null},{"op":"set_seed","seed":N}';
const PATCH_OPS_DESC = `{"ops":[${PATCH_OPS_LIST}]}. Ops use 0-based scene indexes.`;

/** Instructions+input for POST /ai/respond to turn a chat message into patch ops. */
export function buildPatchRespond(planJson, message, history = "") {
  const convo = String(history || "").trim().slice(0, 3000);
  return {
    instructions:
      "Turn the user message into MotionPlan patch ops. Reply with JSON only, no prose outside the JSON: " +
      `{"ops":[${PATCH_OPS_LIST}], "message":"short human reply to the user in their language (1-2 sentences, say what will change)"}. ` +
      "Only emit set_duration_secs when the user explicitly asks for a different duration. " +
      "The human reply goes in the message field, never as prose around the JSON.",
    input:
      `plan: ${clip(planJson, 8000)}\nmessage: ${clip(message, 2000)}` +
      (convo ? `\nconversation so far (use it as context for this turn):\n${convo}` : ""),
  };
}

/**
 * Flatten thread messages into compact context lines for the agent.
 * The just-sent user text travels separately as `message`, so the trailing
 * duplicate is dropped. Keeps the last turns, capped. Pure.
 */
export function threadHistoryForAgent(messages, currentText, maxTurns = 6, maxChars = 3000) {
  const lines = [];
  for (const m of messages || []) {
    if (!m || (m.kind !== "user" && m.kind !== "ai")) continue;
    const text = String(m.text || "").trim();
    if (!text) continue;
    lines.push(`${m.kind === "user" ? "user" : "assistant"}: ${text}`);
  }
  const cur = String(currentText || "").trim();
  if (cur && lines.length && lines[lines.length - 1] === `user: ${cur}`) lines.pop();
  const out = lines.slice(-Math.max(1, maxTurns)).join("\n");
  return out.length > maxChars ? out.slice(-maxChars) : out;
}
/** Messages for POST /ai/chat to turn a chat message into patch ops (fallback path). */
export function buildPatchPrompt(planJson, message) {
  return [
    {
      role: "system",
      content:
        "Turn the user message into MotionPlan patch ops. Reply with JSON only: " +
        PATCH_OPS_DESC +
        " Only emit set_duration_secs when the user explicitly asks for a different duration.",
    },
    {
      role: "user",
      content: `plan: ${clip(planJson, 8000)}\nmessage: ${clip(message, 2000)}`,
    },
  ];
}

/**
 * Apply a validated Auto resolution to a plan (pure). Returns a new plan
 * object; throws structured errors on any contract violation.
 */
export function applyAutoResolution(plan, resolution) {
  const secs = Number(resolution && resolution.duration_secs);
  if (!Number.isFinite(secs) || secs < 1 || secs > 60) {
    throw codedError("bad_resolution", "duration_secs must be within 1..=60");
  }
  // Free canvas: no style to validate. Extra style_* fields are ignored.
  return { ...plan, duration: secs, style: "free" };
}

/**
 * Validate a model-provided scene visual. Only paintable kinds pass:
 * stock (query searched via the proxy) and asset (uploader-provided id).
 * Anything else falls back to the authored default the machine fills next
 * (an authored HyperFrames doc executed by the authored runtime).
 * Mirrors the Rust Visual contract (asset id / stock query non-empty).
 */
export function resolveSceneVisual(visual, index = 0) {
  const fallback = { kind: "authored", doc_id: "" };
  if (!visual || typeof visual !== "object") return fallback;
  if (visual.kind === "stock" && String(visual.query || "").trim()) {
    return { kind: "stock", query: String(visual.query).trim().slice(0, 200) };
  }
  if (visual.kind === "asset" && String(visual.id || "").trim()) {
    return { kind: "asset", id: String(visual.id).trim().slice(0, 200) };
  }
  if (visual.kind !== undefined && visual.kind !== "authored") {
    throw codedError("bad_resolution", `scenes[${index}].visual has unknown kind`);
  }
  return fallback;
}

/**
 * Attach validated scene briefs to a plan (pure). Scenes without a usable
 * model visual start with an empty authored doc id; the machine authors
 * each one next.
 */
export function applyResolvedScenes(plan, scenes) {
  if (!Array.isArray(scenes) || !scenes.length) {
    throw codedError("bad_resolution", "at least one scene brief is required");
  }
  const mapped = scenes.map((scene, index) => {
    const duration_secs = Number(scene && scene.duration_secs);
    if (!Number.isFinite(duration_secs) || duration_secs <= 0) {
      throw codedError("bad_resolution", `scenes[${index}].duration_secs must be positive`);
    }
    if (!scene.brief || !String(scene.brief).trim()) {
      throw codedError("bad_resolution", `scenes[${index}].brief is required`);
    }
    if (!scene.transition || !String(scene.transition).trim()) {
      throw codedError("bad_resolution", `scenes[${index}].transition is required`);
    }
    return {
      duration_secs,
      brief: String(scene.brief),
      text: String(scene.text || ""),
      transition: String(scene.transition),
      visual: resolveSceneVisual(scene.visual, index),
    };
  });
  const sum = mapped.reduce((total, scene) => total + scene.duration_secs, 0);
  const expected = Number(plan.duration);
  if (!Number.isFinite(expected) || Math.abs(sum - expected) > 0.05) {
    throw codedError("bad_resolution", "scene briefs must sum to the resolved duration");
  }
  return { ...plan, scenes: mapped };
}

const FONT_CHARSET = /^[A-Za-z0-9][A-Za-z0-9 +-]*$/;

/** Google Fonts css2 URL for a brand family (same charset as Rust). */
export function googleFontUrl(family, weights = [400, 600, 700]) {
  if (typeof family !== "string" || !FONT_CHARSET.test(family) || family.length > 64) {
    throw codedError("bad_font", "invalid Google Fonts family name");
  }
  const encoded = family.trim().replace(/ +/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weights.join(";")}&display=swap`;
}

/** :root CSS variables carrying brand colors + font into HyperFrames docs. */
export function brandCssVars(brand) {
  const colors = Array.isArray(brand.colors) ? brand.colors : [];
  if (!colors.length) throw codedError("bad_brand", "at least one brand color is required");
  const declarations = colors.map((color, index) => `  --brand-${index}: ${color};`);
  declarations.push(`  --brand-font: '${brand.font || "Figtree"}', sans-serif;`);
  return `:root {\n${declarations.join("\n")}\n}`;
}

/**
 * Sample a <video> element at 1fps into small RGBA frames (browser-only).
 * Thin by design: returns raw frames for extractPalette; pending real run.
 */
export async function sampleVideoFrames(video, { fps = 1, width = 160 } = {}) {
  if (typeof document === "undefined" || !video.duration) {
    throw codedError("no_video", "sampleVideoFrames needs a loaded video element");
  }
  const canvas = document.createElement("canvas");
  const height = Math.max(1, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const frames = [];
  const step = 1 / fps;
  for (let t = 0; t < video.duration; t += step) {
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
    await new Promise((resolve) => {
      video.onseeked = () => resolve();
    });
    frames.push(ctx.getImageData(0, 0, width, height).data.slice());
  }
  return frames;
}
