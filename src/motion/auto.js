/**
 * Auto style/duration resolution + brand plumbing (Slice 4).
 *
 * Split by testability:
 * - PURE (tested here): palette extraction from pixels, prompt builders
 *   with caps, resolution applier with validation, Google Fonts URL and
 *   CSS variables.
 * - LIVE (needs proxy + key): sending the prompts, sampling video frames
 *   in the browser. Kept thin and marked; no logic hides there.
 */
import { presetIds } from "../../web-render/src/presets.js";

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
  `Available presets: ${presetIds().join(", ")}.`,
  "Reply with JSON only: {\"duration_secs\": 1..60, \"style_id\": \"<preset>\", \"style_version\": \"<pinned>\"}.",
  "duration_secs must be within 1..=60. Never invent other fields.",
].join(" ");

/** Messages for POST /ai/chat to resolve Auto duration + style. */
export function buildResolvePrompt({ prompt, ratio, palette = [], hasVideoReference = false }) {
  const lines = [
    `prompt: ${clip(prompt, PROMPT_CHAR_CAP)}`,
    `ratio: ${ratio}`,
    hasVideoReference
      ? "video reference frames were sampled (motion language follows the reference)"
      : "no video reference",
  ];
  if (palette.length) lines.push(`reference palette: ${palette.join(", ")}`);
  return [
    { role: "system", content: RESOLVE_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Messages for POST /ai/chat to author one HyperFrames scene document. */
export function buildScenePrompt({ prompt, sceneBrief, styleId, brand }) {
  return [
    {
      role: "system",
      content: `Author one deterministic HyperFrames scene (HTML+GSAP) in preset ${styleId}. Reply with the document only, no prose.`,
    },
    {
      role: "user",
      content: [
        `video: ${clip(prompt, PROMPT_CHAR_CAP)}`,
        `scene: ${clip(sceneBrief, 1000)}`,
        `brand colors: ${(brand.colors || []).join(", ")}; font: ${brand.font || "Figtree"}`,
      ].join("\n"),
    },
  ];
}

/** Messages for POST /ai/chat to turn a chat message into patch ops. */
export function buildPatchPrompt(planJson, message) {
  return [
    {
      role: "system",
      content:
        "Turn the user message into MotionPlan patch ops. Reply with JSON only: " +
        '{"ops":[{"op":"set_duration_secs","secs":N},{"op":"set_style_preset","id":"x","version":"y"},' +
        '{"op":"set_style_auto"},{"op":"set_brand","colors":[],"font":""},' +
        '{"op":"update_scene","index":N},{"op":"add_scene","index":N},{"op":"remove_scene","index":N},' +
        '{"op":"set_music_track","track_id":null},{"op":"set_seed","seed":N}]}. Ops use 0-based scene indexes.',
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
  const { style_id, style_version } = resolution || {};
  if (typeof style_id !== "string" || !style_id || typeof style_version !== "string" || !style_version) {
    throw codedError("bad_resolution", "style_id and style_version are required");
  }
  if (!presetIds().includes(style_id)) {
    throw codedError("unknown_preset", `preset: ${style_id}`);
  }
  return { ...plan, duration: secs, style: { id: style_id, version: style_version } };
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

export { presetIds };
