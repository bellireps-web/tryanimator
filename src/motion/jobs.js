/**
 * Motion job state machine (Slice 6).
 * queued -> resolving -> authoring -> rendering -> done, or failed anytime.
 *
 * The machine performs no I/O itself: every side effect goes through
 * injected adapters, so the full lifecycle is unit-testable with fakes.
 * Default browser adapters are provided for the real UI path.
 */
import { buildResolvePrompt, buildScenePrompt, buildPatchPrompt, buildPatchRespond, buildResolveRespond } from "./auto.js";
import { applyAutoResolution, applyResolvedScenes, wantsMultipleScenes, mergeScenesToOne } from "./auto.js";
import { MOTION_SCORE_THRESHOLD, SPREAD_SCORE_THRESHOLD, BUILD_SCORE_THRESHOLD, hasStaggeredEntrances, findDanglingSelectors } from "../../web-render/src/authored.js";
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

/** Max reference images forwarded to the model (cost/latency bound). */
export const MAX_REFERENCE_IMAGES = 4;

/** Shape composer state into a plan input (trimming/defaults only). */
export function buildMotionPlanInput({ prompt, ratio, duration, style, brand, reference, seed, palette, referenceImages, hasVideoReference, referenceVideoKey, sceneCount }) {
  const trimmed = String(prompt || "").trim();
  const resolvedRatio = RATIO_DIMS[ratio] ? ratio : "9:16";
  const cleanImages = Array.isArray(referenceImages)
    ? referenceImages.filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, MAX_REFERENCE_IMAGES)
    : [];
  const cleanPalette = Array.isArray(palette) ? [...new Set(palette.filter((c) => typeof c === "string"))].slice(0, 5) : [];
  const refBits = cleanImages.map((u) => hashString(u.slice(0, 4000)).slice(0, 8));
  if (typeof referenceVideoKey === "string" && referenceVideoKey) refBits.push(hashString(referenceVideoKey).slice(0, 8));
  const refHash = refBits.length ? `\nref:${refBits.join(",")}` : "";
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
    palette: cleanPalette,
    referenceImages: cleanImages,
    hasVideoReference: Boolean(hasVideoReference),
    referenceVideoKey: typeof referenceVideoKey === "string" ? referenceVideoKey : null,
    sceneCount: (() => {
      const n = Math.floor(Number(sceneCount));
      return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : null;
    })(),
    // Deterministic per input so identical jobs share cache keys.
    // Reference images participate so different refs never share renders.
    seed:
      Number.isFinite(seed) && seed >= 0
        ? Math.floor(seed)
        : Number.parseInt(hashString(`${trimmed}\n${resolvedRatio}${refHash}`).slice(0, 8), 16),
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
 * Apply the 7 transport patch ops to a plain plan object.
 * Returns a new plan; throws {code:'bad_op'} on unknown ops or bad indexes.
 * (Style ops were removed with the preset catalog: free canvas.)
 */
export function applyPatchOps(plan, ops) {
  const next = JSON.parse(JSON.stringify(plan));
  next.scenes = next.scenes || [];
  for (const op of ops) {
    switch (op.op) {
      case "set_duration_secs":
        next.duration = op.secs;
        break;
      case "set_brand":
        next.brand = { colors: [...op.colors], font: op.font };
        break;
      case "update_scene": {
        const scene = next.scenes[op.index];
        if (!scene) throw codedError("bad_op", `no scene at index ${op.index}`);
        if (op.duration_secs !== undefined) scene.duration_secs = op.duration_secs;
        if (op.text !== undefined) scene.text = op.text;
        if (op.brief !== undefined) scene.brief = op.brief;
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

/** Strip volatile ids so scene comparison reflects content, not cache keys. */
function sceneCore(scene) {
  const { visual, ...rest } = scene || {};
  const { doc_id, ...visualRest } = visual || {};
  return JSON.stringify({ scene: rest, visual: visualRest });
}

/**
 * Carry a chat revision into re-authoring: scenes whose content changed (or
 * the brand) lose their authored doc_id so the machine rebuilds them, and
 * the user's text travels alongside for the author prompt. Each rebuilt
 * scene also carries its previous HTML (previousDoc) so the model EDITS it
 * instead of starting over. When nothing changed (model encoded no visual
 * edit), every authored scene is rebuilt with the revision note as fallback.
 * getDoc(doc_id) is sync and optional. Pure.
 */
export function applyRevisionToChangedScenes(prevPlan, nextPlan, userText, getDoc) {
  const plan = JSON.parse(JSON.stringify(nextPlan));
  plan.scenes = plan.scenes || [];
  const prev = (prevPlan && prevPlan.scenes) || [];
  const brandChanged = JSON.stringify((prevPlan && prevPlan.brand) || null) !== JSON.stringify(plan.brand || null);
  let touched = 0;
  const mark = (scene, index) => {
    touched += 1;
    const visual = { ...(scene.visual || {}) };
    if (visual.kind === "authored" || !visual.kind) {
      visual.kind = "authored";
      visual.doc_id = "";
    }
    const marked = { ...scene, visual, revision: userText };
    const prevId = prev[index] && prev[index].visual && prev[index].visual.doc_id;
    if (typeof getDoc === "function" && prevId) {
      try {
        const html = getDoc(prevId);
        if (typeof html === "string" && html) marked.previousDoc = html;
      } catch {
        // Doc unavailable: rebuild from the brief.
      }
    }
    return marked;
  };
  plan.scenes = plan.scenes.map((scene, index) => {
    if (brandChanged || sceneCore(prev[index]) !== sceneCore(scene)) return mark(scene, index);
    return scene;
  });
  if (touched === 0) {
    plan.scenes = plan.scenes.map((scene, index) =>
      scene.visual && scene.visual.kind === "authored" ? mark(scene, index) : scene,
    );
  }
  return plan;
}

/** Indexes of authored scenes awaiting (re-)authoring in a plan. Pure. */
export function authoredEmptyIndexes(plan) {
  return ((plan && plan.scenes) || [])
    .map((scene, index) => (scene.visual && scene.visual.kind === "authored" && !scene.visual.doc_id ? index : -1))
    .filter((index) => index >= 0);
}

/**
 * Append a job snapshot to a turn's step log for the thread's activity feed.
 * Records state transitions and coarse progress (steps closer than 5% merge
 * into the previous one, except the final done/failed). Pure over the array.
 */
export function recordTurnStep(steps, snapshot, at = Date.now()) {
  if (!Array.isArray(steps)) return steps;
  if (!snapshot || typeof snapshot.state !== "string") return steps;
  const progress = Math.round((snapshot.progress || 0) * 100);
  const last = steps[steps.length - 1];
  if (
    last &&
    last.state === snapshot.state &&
    snapshot.state !== "done" &&
    snapshot.state !== "failed" &&
    Math.abs(progress - last.progress) < 5
  ) {
    last.progress = progress;
    return steps;
  }
  steps.push({ state: snapshot.state, progress, at });
  return steps;
}

/** AI adapter over POST {proxyBase}/ai/chat. Pure mapping, fetch injected. */
export class ProxyAiAdapter {
  constructor({ proxyBase, appToken, model = "muse-spark-1.3", fetchImpl = (...args) => fetch(...args) } = {}) {
    this.proxyBase = proxyBase;
    this.appToken = appToken;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 };
  }

  /** Take accumulated token usage since the last drain (chat completions
   *  exposes reasoning only as a count, never as text). */
  drainUsage() {
    const taken = { ...this.usage };
    this.usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 };
    return taken;
  }

  noteUsage(body) {
    const usage = body && body.usage;
    if (!usage) return;
    this.usage.prompt_tokens += Number(usage.prompt_tokens) || 0;
    this.usage.completion_tokens += Number(usage.completion_tokens) || 0;
    const details = usage.completion_tokens_details || {};
    this.usage.reasoning_tokens += Number(details.reasoning_tokens) || 0;
    this.usage.cached_tokens += Number((usage.prompt_tokens_details || {}).cached_tokens) || 0;
  }

  requireConfigured() {
    if (!this.proxyBase || !this.appToken) {
      throw codedError(
        "proxy_not_configured",
        "set the proxy URL and app token to enable AI",
      );
    }
  }

  async chat(messages, { maxTokens = 4096, images = [], retried = false, reasoningEffort = "low", temperature } = {}) {
    this.requireConfigured();
    let outMessages = messages;
    const cleanImages = Array.isArray(images)
      ? images.filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, MAX_REFERENCE_IMAGES)
      : [];
    if (cleanImages.length && Array.isArray(messages) && messages.length) {
      // OpenAI-compatible multimodal: text + image_url parts on the last turn.
      outMessages = messages.map((m, i) => {
        if (i !== messages.length - 1 || !m || typeof m.content !== "string") return m;
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            ...cleanImages.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        };
      });
    }
    let response;
    try {
      // Low reasoning keeps token room for long authored documents under
      // the 8192 cap; these are constrained generations, not open research.
      const payload = { model: this.model, messages: outMessages, max_tokens: maxTokens };
      if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
      if (temperature !== undefined) payload.temperature = temperature;
      response = await this.fetchImpl(
        `${this.proxyBase}/ai/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-app-token": this.appToken },
          body: JSON.stringify(payload),
          ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? { signal: AbortSignal.timeout(150000) }
            : {}),
        },
      );
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw codedError("provider_transport", "AI request timed out after 150s");
      }
      throw error;
    }
    let body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((body && body.message) || `AI error ${response.status}`);
      error.code = (body && body.code) || "provider_transport";
      throw error;
    }
    this.noteUsage(body);
    let content = body?.choices?.[0]?.message?.content;
    if ((typeof content !== "string" || !content.trim()) && !retried) {
      // Upstream occasionally returns no content (reasoning exhausted the
      // token budget): a single immediate retry before failing visibly.
      return this.chat(messages, { maxTokens, images, reasoningEffort, temperature, retried: true });
    }
    if (typeof content !== "string" || !content.trim()) {
      throw codedError("provider_invalid_output", "empty model response");
    }
    return content;
  }

  /** True when reference images must travel (Responses has no image lane). */
  hasReferenceImages(referenceImages) {
    return (
      Array.isArray(referenceImages) &&
      referenceImages.some((u) => typeof u === "string" && u.startsWith("data:image/"))
    );
  }

  parseResolution(text) {
    let parsed;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      throw codedError("provider_invalid_output", "resolution is not JSON");
    }
    return parsed;
  }

  async resolveAuto({ prompt, ratio, duration, referenceImages, sceneCount }) {
    if (!this.hasReferenceImages(referenceImages)) {
      try {
        const { instructions, input } = buildResolveRespond({ prompt, ratio, duration, sceneCount });
        const { text, thinking } = await this.respond({ input, instructions, maxOutputTokens: 4096 });
        return { ...this.parseResolution(text), thinking };
      } catch (error) {
        if (!error || error.code !== "provider_invalid_output") throw error;
        // fall through to the legacy chat path below
      }
    }
    const content = await this.chat(
      buildResolvePrompt({ prompt, ratio, duration, sceneCount }),
      { images: referenceImages },
    );
    return { ...this.parseResolution(content), thinking: "" };
  }

  async authorScene({ prompt, sceneBrief, brand, referenceImages, sceneDuration, ratio, revision, currentDoc, temperature }) {
    const [sys, usr] = buildScenePrompt({ prompt, sceneBrief, brand, sceneDuration, ratio, revision, currentDoc });
    const options = {
      maxTokens: 8192,
      images: referenceImages,
      ...(temperature !== undefined ? { temperature } : {}),
    };
    if (!this.hasReferenceImages(referenceImages)) {
      try {
        const { text } = await this.respond({
          input: usr.content,
          instructions: sys.content,
          maxOutputTokens: 8192,
          ...(temperature !== undefined ? { temperature } : {}),
        });
        if (typeof text !== "string" || !text.trim()) {
          throw codedError("provider_invalid_output", "empty model response");
        }
        return text;
      } catch (error) {
        if (!error || error.code !== "provider_invalid_output") throw error;
        // fall through to the legacy chat path below
      }
    }
    return this.chat(buildScenePrompt({ prompt, sceneBrief, brand, sceneDuration, ratio, revision, currentDoc }), options);
  }

  async chatPatch(planJson, message, history = "") {
    const { instructions, input } = buildPatchRespond(planJson, message, history);
    const parsePatch = (text) => {
      let parsed;
      try {
        parsed = JSON.parse(extractJson(text));
      } catch {
        throw codedError("provider_invalid_output", "patch is not JSON");
      }
      if (!parsed || !Array.isArray(parsed.ops)) {
        throw codedError("provider_invalid_output", "patch has no ops array");
      }
      return parsed;
    };
    try {
      const { text, thinking } = await this.respond({ input, instructions });
      const parsed = parsePatch(text);
      return {
        ops: parsed.ops,
        message: typeof parsed.message === "string" ? parsed.message : "",
        thinking,
      };
    } catch (error) {
      if (error && error.code === "provider_invalid_output") {
        // Fallback: legacy chat-completions path (no thinking, no words).
        const content = await this.chat(buildPatchPrompt(planJson, message));
        const parsed = parsePatch(content);
        return { ops: parsed.ops, message: "", thinking: "" };
      }
      throw error;
    }
  }

  /**
   * Responses API call (reasoning summaries). Returns { text, thinking } and
   * meters usage. Raw reasoning stays private; only the summary is visible.
   */
  async respond({ input, instructions, reasoning = { effort: "low", summary: "concise" }, maxOutputTokens = 2048, temperature, retried = false } = {}) {
    this.requireConfigured();
    const payload = { model: this.model, input, store: false, max_output_tokens: maxOutputTokens };
    if (instructions) payload.instructions = instructions;
    if (reasoning) payload.reasoning = reasoning;
    if (temperature !== undefined) payload.temperature = temperature;
    let response;
    try {
      response = await this.fetchImpl(`${this.proxyBase}/ai/respond`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": this.appToken },
        body: JSON.stringify(payload),
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? { signal: AbortSignal.timeout(150000) }
          : {}),
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw codedError("provider_transport", "AI request timed out after 150s");
      }
      throw error;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((body && body.message) || `AI error ${response.status}`);
      error.code = (body && body.code) || "provider_transport";
      throw error;
    }
    this.noteResponsesUsage(body);
    const parsed = parseResponsesBody(body);
    if ((!parsed.text || !parsed.text.trim()) && !retried) {
      // Same single-retry policy as chat(): upstream sometimes returns
      // reasoning with no visible text.
      return this.respond({ input, instructions, reasoning, maxOutputTokens, temperature, retried: true });
    }
    return parsed;
  }

  noteResponsesUsage(body) {
    const usage = body && body.usage;
    if (!usage) return;
    this.usage.prompt_tokens += Number(usage.input_tokens) || 0;
    this.usage.completion_tokens += Number(usage.output_tokens) || 0;
    const details = usage.output_tokens_details || {};
    this.usage.reasoning_tokens += Number(details.reasoning_tokens) || 0;
    this.usage.cached_tokens += Number((usage.input_tokens_details || {}).cached_tokens) || 0;
  }
}

/**
 * Split a Responses API body into visible text + thinking summary.
 * A missing summary is normal (model produced little reasoning): thinking
 * comes back empty rather than failing. Pure.
 */
export function parseResponsesBody(body) {
  const output = body && body.output;
  if (!Array.isArray(output)) throw codedError("provider_invalid_output", "malformed responses body");
  let text = "";
  let thinking = "";
  for (const item of output) {
    if (item && item.type === "message") {
      for (const part of item.content || []) {
        if (part && part.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    } else if (item && item.type === "reasoning") {
      for (const summary of item.summary || []) {
        if (typeof summary === "string") thinking += summary;
        else if (summary && summary.type === "summary_text" && typeof summary.text === "string") {
          thinking += (thinking ? "\n\n" : "") + summary.text;
        }
      }
    }
  }
  return { text: text.trim(), thinking: thinking.trim() };
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
        duration: input.duration,
        referenceImages: input.referenceImages || [],
        sceneCount: input.sceneCount || null,
      });
      // Resolve thinking (Responses path) travels to the v1 thread message.
      // Fakes and the legacy chat path leave it empty.
      job.resolveThinking = (resolution && resolution.thinking) || "";
      if (plan.duration === "auto") {
        plan = applyAutoResolution(plan, resolution);
      } else if (plan.style === "auto") {
        // Free canvas: no style to choose. Extra style_* fields are ignored.
        plan = { ...plan, style: "free" };
      }
      // Single scene by default; multiple when the user asked in text or
      // picked an explicit count in the composer (then the model's count
      // is kept as-is, still validated to sum to the duration).
      let scenes = resolution.scenes || [];
      const explicitScenes = Number.isFinite(input.sceneCount) && input.sceneCount >= 1;
      if (!explicitScenes && !wantsMultipleScenes(input.prompt)) scenes = mergeScenesToOne(scenes);
      plan = applyResolvedScenes(plan, scenes);
    }

    setState(job, "authoring", { progress: 0.2, plan }, onChange);
    const docs = adapters.docs || new Map();
    const authorDocForScene = async (scene, index) => {
      const sceneInput = {
        sceneBrief: scene.brief || scene.text,
        brand: plan.brand,
        referenceImages: input.referenceImages || [],
        sceneDuration: scene.duration_secs,
        ratio: plan.ratio,
      };
      // Chat revisions edit the existing document: pass it along and lower
      // the temperature so the model preserves everything unrelated.
      if (scene.revision) {
        sceneInput.revision = scene.revision;
        sceneInput.temperature = 0.2;
      }
      if (scene.previousDoc) sceneInput.currentDoc = scene.previousDoc;
      let doc = await adapters.ai.authorScene(sceneInput);
      delete scene.revision;
      delete scene.previousDoc;
      // Liveliness gate (browser-only; without a stage the first doc is
      // kept as-is): the doc must build up from a nearly empty frame
      // (staggered entrances, early pixel change) and keep moving. A single
      // retry rebuilds from scratch — entrances are global, a minimal edit
      // of an entrance-less doc rarely fixes them. Every evaluation lands on
      // job.gateReports so the thread can show why a doc passed or retried.
      if (adapters.authored) {
        const report = { scene: index, attempts: 1, problems: [] };
        try {
          const dims = RATIO_DIMS[input.ratio] || RATIO_DIMS["9:16"];
          const evaluate = async (html) => {
            const found = [];
            const dangling = findDanglingSelectors(html);
            if (dangling.length) {
              found.push(
                `missing selectors (${dangling.slice(0, 8).join(", ")})`,
              );
            }
            if (!hasStaggeredEntrances(html)) {
              found.push("no staggered entrances");
            }
            const scoreArgs = { docId: `draft-s${index}`, html, width: dims[0], height: dims[1] };
            const score = await adapters.authored.score(scoreArgs);
            if (score < MOTION_SCORE_THRESHOLD) {
              found.push(`motion ${score.toFixed(3)}`);
            }
            if (typeof adapters.authored.spreadScore === "function") {
              const spread = await adapters.authored.spreadScore(scoreArgs);
              if (spread.minWindow < SPREAD_SCORE_THRESHOLD || spread.build < BUILD_SCORE_THRESHOLD) {
                found.push(`spread ${spread.minWindow.toFixed(3)}/${spread.build.toFixed(3)}`);
              }
            }
            return found;
          };
          report.problems = await evaluate(doc);
          if (report.problems.length) {
            report.attempts = 2;
            const fresh = {
              ...sceneInput,
              sceneBrief:
                `CRITICAL: the previous version failed (${report.problems.join("; ")}). ` +
                `Rebuild from scratch so almost nothing is visible at time 0 and the build-up completes ` +
                `in the first half: title in the first second, then every text, object and shape entering ` +
                `with its own tween one by one, with continuous motion across every second. ` +
                `A title that is simply visible from time 0 with no entrance tween is a FAILURE — ` +
                `every element must start hidden (opacity 0) and animate in. ` +
                `Original brief: ${scene.brief || scene.text}`,
            };
            delete fresh.currentDoc;
            doc = await adapters.ai.authorScene(fresh);
            report.retryProblems = await evaluate(doc);
          }
        } catch {
          // Scorer unavailable (Node) or doc unloadable: keep first doc.
        }
        job.gateReports = [...(job.gateReports || []), report];
      }
      // Content-addressed so identical inputs share plan keys and cache hits
      // across jobs; job-scoped ids would poison the key per run.
      const docId = `doc/${hashString(typeof doc === "string" ? doc : stableJson(doc)).slice(0, 12)}-s${index}`;
      if (docs.put) await docs.put(docId, doc);
      else docs.set(docId, doc);
      scene.visual.doc_id = docId;
    };
    for (let i = 0; i < plan.scenes.length; i++) {
      const scene = plan.scenes[i];
      if (scene.visual && scene.visual.kind === "authored" && !scene.visual.doc_id) {
        await authorDocForScene(scene, i);
        setState(job, "authoring", { progress: 0.2 + (0.3 * (i + 1)) / plan.scenes.length }, onChange);
      }
    }

    if (adapters.validate) await adapters.validate(plan);
    setState(job, "rendering", { progress: 0.5, plan }, onChange);

    const key = planKey(stableJson(plan));
    if (adapters.cache) {
      const hit = await adapters.cache.get(finalKey(key, "mux-v2"));
      if (hit) {
        setState(job, "done", { progress: 1, result: { plan, cached: true, video: hit } }, onChange);
        return job;
      }
    }

    const images = new Map();
    if (adapters.images) {
      for (let index = 0; index < plan.scenes.length; index++) {
        const scene = plan.scenes[index];
        const visual = scene.visual || {};
        const ref = visual.kind === "asset" ? visual.id : visual.kind === "stock" ? `stock:${visual.query}` : null;
        if (!ref || images.has(ref)) continue;
        try {
          images.set(ref, await adapters.images.load(ref));
        } catch (error) {
          if (visual.kind !== "stock") throw error;
          // No stock provider (or search failed): author the backdrop instead
          // of failing the whole video. Direct asset loads keep failing hard.
          scene.visual = { kind: "authored", doc_id: "" };
          await authorDocForScene(scene, index);
        }
      }
    }
    const segmentList = segments(plan.scenes.reduce((s, scene) => s + scene.duration_secs, 0), 600);
    const segmentStats = await adapters.renderer.renderSegments(plan, {
      dims,
      images,
      segments: segmentList,
      cache: adapters.cache,
      planKey: key,
      docs: adapters.docs,
      onProgress: (done, total) =>
        setState(job, "rendering", { progress: 0.5 + (0.5 * done) / total }, onChange),
    });

    let video = null;
    if (adapters.mux) {
      video = await adapters.mux.mux({ plan, segmentStats });
      if (adapters.cache) {
        await adapters.cache.put(finalKey(key, "mux-v2"), video, video.byteLength || video.length || 0);
      }
    }
    setState(
      job,
      "done",
      { progress: 1, result: { plan, segmentStats, video, muxPending: !adapters.mux, usage: takeUsage(adapters), thinking: job.resolveThinking || "" } },
      onChange,
    );
    return job;
  } catch (error) {
    return fail(error);
  }
}

/** Drain AI token usage when the adapter tracks it (browser path). Pure-safe. */
function takeUsage(adapters) {
  try {
    if (adapters && adapters.ai && typeof adapters.ai.drainUsage === "function") {
      return adapters.ai.drainUsage();
    }
  } catch {
    // Usage is observability only; never fail the job for it.
  }
  return null;
}
