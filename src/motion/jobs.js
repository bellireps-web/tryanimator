/**
 * Motion job state machine (Slice 6).
 * queued -> resolving -> authoring -> rendering -> done, or failed anytime.
 *
 * The machine performs no I/O itself: every side effect goes through
 * injected adapters, so the full lifecycle is unit-testable with fakes.
 * Default browser adapters are provided for the real UI path.
 */
import { buildResolvePrompt, buildScenePrompt, buildPatchPrompt } from "./auto.js";
import { applyAutoResolution, applyResolvedScenes } from "./auto.js";
import { presetIds } from "../../web-render/src/presets.js";
import { planKey, segmentKey, finalKey, hashString } from "../cache/keys.js";
import { segments } from "../../web-render/src/clock.js";

export const RATIO_DIMS = {
  "16:9": [1920, 1080],
  "9:16": [608, 1080],
  "1:1": [1080, 1080],
  "4:3": [1440, 1080],
};

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Canonical JSON: sorted keys, for stable cache keys. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Shape composer state into a plan input (trimming/defaults only). */
export function buildMotionPlanInput({ prompt, ratio, duration, style, brand, reference, seed }) {
  const trimmed = String(prompt || "").trim();
  const resolvedRatio = RATIO_DIMS[ratio] ? ratio : "9:16";
  return {
    prompt: trimmed,
    ratio: resolvedRatio,
    duration: duration === "auto" || duration === undefined ? "auto" : Number(duration),
    style: style || "auto",
    brand: {
      colors: Array.isArray(brand?.colors) && brand.colors.length ? [...brand.colors] : ["#7069AA"],
      font: String(brand?.font || "Figtree"),
    },
    reference: reference || null,
    // Deterministic per input so identical jobs share cache keys.
    seed:
      Number.isFinite(seed) && seed >= 0
        ? Math.floor(seed)
        : Number.parseInt(hashString(`${trimmed}\n${resolvedRatio}`).slice(0, 8), 16),
  };
}

let jobCounter = 0;

export function createMotionJob(input) {
  jobCounter += 1;
  return {
    id: `motion-${Date.now().toString(36)}-${jobCounter}`,
    type: "motion",
    state: "queued",
    progress: 0,
    input,
    plan: null,
    result: null,
    error: null,
  };
}

function setState(job, state, patch, onChange) {
  job.state = state;
  Object.assign(job, patch);
  if (onChange) onChange({ ...job });
}

/** Strip ```json fences the model sometimes adds. */
export function extractJson(text) {
  const fenced = String(text || "").match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced ? fenced[1] : String(text || "")).trim();
}

/**
 * Apply the 9 transport patch ops to a plain plan object.
 * Returns a new plan; throws {code:'bad_op'} on unknown ops or bad indexes.
 */
export function applyPatchOps(plan, ops) {
  const next = JSON.parse(JSON.stringify(plan));
  next.scenes = next.scenes || [];
  for (const op of ops) {
    switch (op.op) {
      case "set_duration_secs":
        next.duration = op.secs;
        break;
      case "set_style_preset":
        next.style = { id: op.id, version: op.version };
        break;
      case "set_style_auto":
        next.style = "auto";
        break;
      case "set_brand":
        next.brand = { colors: [...op.colors], font: op.font };
        break;
      case "update_scene": {
        const scene = next.scenes[op.index];
        if (!scene) throw codedError("bad_op", `no scene at index ${op.index}`);
        if (op.duration_secs !== undefined) scene.duration_secs = op.duration_secs;
        if (op.text !== undefined) scene.text = op.text;
        break;
      }
      case "add_scene":
        if (op.index < 0 || op.index > next.scenes.length) {
          throw codedError("bad_op", `cannot insert scene at index ${op.index}`);
        }
        next.scenes.splice(op.index, 0, {
          duration_secs: 5,
          brief: "",
          text: "New scene",
          transition: "cut",
          visual: { kind: "authored", doc_id: "" },
        });
        break;
      case "remove_scene": {
        if (op.index < 0 || op.index >= next.scenes.length) {
          throw codedError("bad_op", `no scene at index ${op.index}`);
        }
        next.scenes.splice(op.index, 1);
        break;
      }
      case "set_music_track":
        next.audio = next.audio || { music_track_id: null, sfx: [] };
        next.audio.music_track_id = op.track_id;
        break;
      case "set_seed":
        next.seed = op.seed;
        break;
      default:
        throw codedError("bad_op", `unknown patch op: ${op && op.op}`);
    }
  }
  return next;
}

/** AI adapter over POST {proxyBase}/ai/chat. Pure mapping, fetch injected. */
export class ProxyAiAdapter {
  constructor({ proxyBase, appToken, model = "muse-spark-1.3", fetchImpl = fetch } = {}) {
    this.proxyBase = proxyBase;
    this.appToken = appToken;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  requireConfigured() {
    if (!this.proxyBase || !this.appToken) {
      throw codedError(
        "proxy_not_configured",
        "set the proxy URL and app token to enable AI",
      );
    }
  }

  async chat(messages, { maxTokens = 4096 } = {}) {
    this.requireConfigured();
    const response = await this.fetchImpl(`${this.proxyBase}/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-token": this.appToken },
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((body && body.message) || `AI error ${response.status}`);
      error.code = (body && body.code) || "provider_transport";
      throw error;
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw codedError("provider_invalid_output", "empty model response");
    }
    return content;
  }

  async resolveAuto({ prompt, ratio, palette }) {
    const content = await this.chat(buildResolvePrompt({ prompt, ratio, palette }));
    let parsed;
    try {
      parsed = JSON.parse(extractJson(content));
    } catch {
      throw codedError("provider_invalid_output", "resolution is not JSON");
    }
    return parsed;
  }

  async authorScene({ prompt, sceneBrief, styleId, brand }) {
    return this.chat(buildScenePrompt({ prompt, sceneBrief, styleId, brand }), {
      maxTokens: 8192,
    });
  }

  async chatPatch(planJson, message) {
    const content = await this.chat(buildPatchPrompt(planJson, message));
    let parsed;
    try {
      parsed = JSON.parse(extractJson(content));
    } catch {
      throw codedError("provider_invalid_output", "patch is not JSON");
    }
    if (!parsed || !Array.isArray(parsed.ops)) {
      throw codedError("provider_invalid_output", "patch has no ops array");
    }
    return parsed.ops;
  }
}

/**
 * Run a motion job to completion. Adapters:
 * { ai, docs:{put}, images:{load}, stock:{search}, cache:{get,put},
 *   renderer:{renderSegments}, mux:{mux}|null, validate(plan)->void }
 * onChange receives a snapshot on every transition.
 */
export async function runMotionJob(job, adapters, onChange) {
  const fail = (error) => {
    setState(
      job,
      "failed",
      { error: { code: (error && error.code) || "failed", message: String((error && error.message) || error) } },
      onChange,
    );
    return job;
  };
  try {
    const { input } = job;
    if (!input.prompt) throw codedError("bad_request", "prompt is required");

    setState(job, "resolving", { progress: 0.05 }, onChange);
    const dims = RATIO_DIMS[input.ratio] || RATIO_DIMS["9:16"];
    let plan = {
      version: 1,
      ratio: input.ratio,
      height: 1080,
      fps: 30,
      duration: input.duration,
      style: input.style,
      brand: input.brand,
      audio: { music_track_id: null, sfx: [] },
      scenes: [],
      seed: Number.isFinite(input.seed) ? input.seed : 0,
    };
    // Chat follow-ups patch an existing plan: skip straight to authoring
    // (missing doc ids only) and rendering. Untouched concrete fields keep
    // the AI out of the loop, so re-renders are deterministic.
    if (job.basePlan) plan = JSON.parse(JSON.stringify(job.basePlan));

    if (plan.duration === "auto" || plan.style === "auto" || !plan.scenes.length) {
      const resolution = await adapters.ai.resolveAuto({
        prompt: input.prompt,
        ratio: input.ratio,
        palette: input.palette || [],
      });
      if (plan.duration === "auto") {
        plan = applyAutoResolution(plan, resolution);
      } else if (plan.style === "auto") {
        const { style_id, style_version } = resolution || {};
        if (typeof style_id !== "string" || !style_id || typeof style_version !== "string" || !style_version) {
          throw codedError("bad_resolution", "style_id and style_version are required");
        }
        if (!presetIds().includes(style_id)) {
          throw codedError("unknown_preset", `preset: ${style_id}`);
        }
        plan = { ...plan, style: { id: style_id, version: style_version } };
      }
      plan = applyResolvedScenes(plan, resolution.scenes || []);
    }

    setState(job, "authoring", { progress: 0.2, plan }, onChange);
    const docs = adapters.docs || new Map();
    for (let i = 0; i < plan.scenes.length; i++) {
      const scene = plan.scenes[i];
      if (scene.visual && scene.visual.kind === "authored" && !scene.visual.doc_id) {
        const doc = await adapters.ai.authorScene({
          prompt: input.prompt,
          sceneBrief: scene.brief || scene.text,
          styleId: plan.style.id,
          brand: plan.brand,
        });
        // Content-addressed so identical inputs share plan keys and cache hits
        // across jobs; job-scoped ids would poison the key per run.
        const docId = `doc/${hashString(typeof doc === "string" ? doc : stableJson(doc)).slice(0, 12)}-s${i}`;
        if (docs.put) await docs.put(docId, doc);
        else docs.set(docId, doc);
        scene.visual.doc_id = docId;
        setState(job, "authoring", { progress: 0.2 + (0.3 * (i + 1)) / plan.scenes.length }, onChange);
      }
    }

    if (adapters.validate) await adapters.validate(plan);
    setState(job, "rendering", { progress: 0.5, plan }, onChange);

    const key = planKey(stableJson(plan));
    if (adapters.cache) {
      const hit = await adapters.cache.get(finalKey(key, "mux-v1"));
      if (hit) {
        setState(job, "done", { progress: 1, result: { plan, cached: true, video: hit } }, onChange);
        return job;
      }
    }

    const images = new Map();
    if (adapters.images) {
      for (const scene of plan.scenes) {
        const visual = scene.visual || {};
        const ref = visual.kind === "asset" ? visual.id : visual.kind === "stock" ? `stock:${visual.query}` : null;
        if (ref && !images.has(ref)) images.set(ref, await adapters.images.load(ref));
      }
    }
    const segmentList = segments(plan.scenes.reduce((s, scene) => s + scene.duration_secs, 0), 600);
    const segmentStats = await adapters.renderer.renderSegments(plan, {
      dims,
      images,
      segments: segmentList,
      cache: adapters.cache,
      planKey: key,
      onProgress: (done, total) =>
        setState(job, "rendering", { progress: 0.5 + (0.5 * done) / total }, onChange),
    });

    let video = null;
    if (adapters.mux) {
      video = await adapters.mux.mux({ plan, segmentStats });
      if (adapters.cache) {
        await adapters.cache.put(finalKey(key, "mux-v1"), video, video.byteLength || video.length || 0);
      }
    }
    setState(
      job,
      "done",
      { progress: 1, result: { plan, segmentStats, video, muxPending: !adapters.mux } },
      onChange,
    );
    return job;
  } catch (error) {
    return fail(error);
  }
}
