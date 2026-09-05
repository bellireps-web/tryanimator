/**
 * animator-motion-proxy (Slice 1).
 *
 * Holds every provider key server-side. The browser never sees them:
 * it calls this worker with `x-app-token`, and the worker injects the
 * real keys upstream. Zero dependencies; Web standards only, so the
 * handler is unit-testable with plain node:test.
 *
 * Routes:
 *   GET  /health                    -> { ok: true, version }
 *   POST /ai/chat                   -> Meta Model API (muse-spark-*), OpenAI-compatible
 *   POST /ai/respond                 -> Meta Responses API (reasoning summaries)
 *   GET  /stock/images?q=&per_page= -> stock image search (key injected server-side)
 *   GET  /audio/music?mood=         -> music track pick (Pixabay-compatible)
 *   GET  /audio/sfx?name=           -> sfx pick (Pixabay-compatible)
 *
 * Error codes mirror motion-core ApiError/ProviderError codes.
 */

export const VERSION = "0.1.0";

const META_BASE = "https://api.meta.ai/v1";
const MODEL_ALLOWLIST = /^muse-spark-[\w.+-]+$/;
const MAX_TOKENS_CAP = 8192;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 32768;
const MAX_PARTS_PER_MESSAGE = 6;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_CHARS = 2000000;
const STOCK_PAGE_CAP = 25;
const UPSTREAM_TIMEOUT_MS = 120_000;
const SEARCH_TIMEOUT_MS = 15_000;
const RESPOND_INPUT_CAP = 32768;
const RESPOND_INSTRUCTIONS_CAP = 4000;
const RESPOND_OUTPUT_CAP = 2048;
const REASONING_SUMMARIES = ["auto", "concise", "detailed"];

/** Best-effort sliding window per isolate. Documented limit: use Cloudflare
 *  Rate Limiting rules in front of this worker for production hardening. */
const buckets = new Map();
export function resetRateLimits() {
  buckets.clear();
}

function checkRateLimit(key, perMin, now = Date.now()) {
  const windowMs = 60_000;
  let hits = buckets.get(key) || [];
  hits = hits.filter((t) => now - t < windowMs);
  if (hits.length >= perMin) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return retryAfter;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
  return 0;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function apiError(code, message, status, headers = {}) {
  return json({ code, message }, status, headers);
}

function clientIp(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "dev"
  );
}

function corsFor(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // No Origin = non-browser client (curl, tests): allowed, rate limit still applies.
  if (!origin || allowed.includes(origin)) {
    return origin ? { "access-control-allow-origin": origin, vary: "origin" } : {};
  }
  return null;
}

function requireSecret(env, name) {
  const value = env[name];
  if (!value) {
    return apiError("provider_misconfigured", `server secret ${name} is not set`, 500);
  }
  return null;
}

async function mapUpstream(response) {
  if (response.ok) {
    return new Response(response.body, {
      status: 200,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  }
  if (response.status === 401 || response.status === 403) {
    // Surface Meta's own reason (truncated): "rejected credentials" alone
    // cannot distinguish revoked key, wrong project, or missing access.
    // Bodies carry no secrets (the key travels only in our request header).
    let detail = "";
    try {
      const text = await response.text();
      if (text && text.trim()) detail = `: ${text.trim().slice(0, 300)}`;
    } catch {
      detail = "";
    }
    return apiError("provider_unauthorized", `provider rejected credentials${detail}`, 502);
  }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    return json(
      { code: "provider_rate_limited", message: "provider rate limited" },
      502,
      retry ? { "retry-after": retry } : {},
    );
  }
  return apiError("provider_transport", `provider error ${response.status}`, 502);
}

function sanitizeContent(content) {
  // Plain text turn (existing contract).
  if (typeof content === "string") {
    if (!content.length || content.length > MAX_MESSAGE_CHARS) return null;
    return content;
  }
  // Multimodal turn: [{type:"text",text},{type:"image_url",image_url:{url}}].
  if (!Array.isArray(content) || !content.length || content.length > MAX_PARTS_PER_MESSAGE) {
    return null;
  }
  const clean = [];
  let images = 0;
  for (const part of content) {
    if (!part || typeof part.type !== "string") return null;
    if (part.type === "text") {
      if (typeof part.text !== "string" || !part.text.length || part.text.length > MAX_MESSAGE_CHARS) {
        return null;
      }
      clean.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const url = part.image_url && part.image_url.url;
      if (typeof url !== "string" || url.length > MAX_IMAGE_CHARS) return null;
      if (!url.startsWith("data:image/") && !url.startsWith("https://")) return null;
      images += 1;
      if (images > MAX_IMAGES_PER_MESSAGE) return null;
      clean.push({ type: "image_url", image_url: { url } });
    } else {
      return null;
    }
  }
  return clean;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return null;
  }
  const clean = [];
  for (const item of messages) {
    if (!item || typeof item.role !== "string") return null;
    if (!["system", "user", "assistant", "tool"].includes(item.role)) return null;
    const content = sanitizeContent(item.content);
    if (content === null) return null;
    clean.push({ role: item.role, content });
  }
  return clean;
}

async function handleChat(req, env) {
  const missing = requireSecret(env, "META_API_KEY");
  if (missing) return missing;
  let body;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "invalid JSON body", 400);
  }
  const { model, messages, max_tokens, temperature, stream, reasoning_effort } = body ?? {};
  if (typeof model !== "string" || !MODEL_ALLOWLIST.test(model)) {
    return apiError("bad_request", "model must be a muse-spark-* id", 400);
  }
  const clean = sanitizeMessages(messages);
  if (!clean) {
    return apiError("bad_request", "messages must be a non-empty array of role/content", 400);
  }
  const payload = {
    model,
    messages: clean,
    max_tokens:
      Number.isFinite(max_tokens) && max_tokens > 0
        ? Math.min(Math.floor(max_tokens), MAX_TOKENS_CAP)
        : 4096,
  };
  if (temperature !== undefined) {
    if (typeof temperature !== "number" || temperature < 0 || temperature > 2) {
      return apiError("bad_request", "temperature must be within 0..2", 400);
    }
    payload.temperature = temperature;
  }
  // "none" disables reasoning and is rejected by Muse Spark: not accepted here.
  if (reasoning_effort !== undefined) {
    if (!["minimal", "low", "medium", "high", "xhigh"].includes(reasoning_effort)) {
      return apiError("bad_request", "reasoning_effort must be minimal|low|medium|high|xhigh", 400);
    }
    payload.reasoning_effort = reasoning_effort;
  }
  if (stream === true) payload.stream = true;

  let upstream;
  try {
    upstream = await fetch(`${META_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.META_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return apiError(
      "provider_transport",
      timedOut ? "upstream timeout" : "upstream unreachable",
      timedOut ? 504 : 502,
    );
  }
  return mapUpstream(upstream);
}

function sanitizeRespondReasoning(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (value.effort !== undefined) {
    if (!["minimal", "low", "medium", "high", "xhigh"].includes(value.effort)) return null;
    out.effort = value.effort;
  }
  if (value.summary !== undefined) {
    if (!REASONING_SUMMARIES.includes(value.summary)) return null;
    out.summary = value.summary;
  }
  return out;
}

async function handleRespond(req, env) {
  const missing = requireSecret(env, "META_API_KEY");
  if (missing) return missing;
  let body;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "invalid JSON body", 400);
  }
  const { model, input, instructions, reasoning, max_output_tokens, temperature } = body ?? {};
  if (typeof model !== "string" || !MODEL_ALLOWLIST.test(model)) {
    return apiError("bad_request", "model must be a muse-spark-* id", 400);
  }
  if (typeof input !== "string" || !input.length || input.length > RESPOND_INPUT_CAP) {
    return apiError("bad_request", "input must be a non-empty string", 400);
  }
  if (
    instructions !== undefined &&
    (typeof instructions !== "string" || !instructions.length || instructions.length > RESPOND_INSTRUCTIONS_CAP)
  ) {
    return apiError("bad_request", "instructions must be a short string", 400);
  }
  const reasoningOut = sanitizeRespondReasoning(reasoning);
  if (reasoningOut === null) {
    return apiError("bad_request", "reasoning must be {effort?, summary?}", 400);
  }
  const payload = {
    model,
    input,
    store: false,
    max_output_tokens:
      Number.isFinite(max_output_tokens) && max_output_tokens > 0
        ? Math.min(Math.floor(max_output_tokens), MAX_TOKENS_CAP)
        : RESPOND_OUTPUT_CAP,
  };
  if (instructions) payload.instructions = instructions;
  if (reasoningOut.effort || reasoningOut.summary) payload.reasoning = reasoningOut;
  if (temperature !== undefined) {
    if (typeof temperature !== "number" || temperature < 0 || temperature > 2) {
      return apiError("bad_request", "temperature must be within 0..2", 400);
    }
    payload.temperature = temperature;
  }

  let upstream;
  try {
    upstream = await fetch(`${META_BASE}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.META_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return apiError(
      "provider_transport",
      timedOut ? "upstream timeout" : "upstream unreachable",
      timedOut ? 504 : 502,
    );
  }
  return mapUpstream(upstream);
}

async function forwardGet(url, { bearer = null, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const headers = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  try {
    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return mapUpstream(upstream);
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return apiError(
      "provider_transport",
      timedOut ? "upstream timeout" : "upstream unreachable",
      timedOut ? 504 : 502,
    );
  }
}

function clampCount(raw, cap) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(n, cap);
}

async function handleStockImages(req, env, url) {
  if (!env.STOCK_API_KEY || !env.STOCK_API_URL) {
    return apiError("provider_misconfigured", "stock provider is not configured", 500);
  }
  const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
  if (!query) return apiError("bad_request", "missing q", 400);
  const perPage = clampCount(url.searchParams.get("per_page"), STOCK_PAGE_CAP);
  const target =
    `${env.STOCK_API_URL.replace(/\/$/, "")}/search?` +
    `q=${encodeURIComponent(query)}&per_page=${perPage}`;
  return forwardGet(target, { bearer: env.STOCK_API_KEY });
}

function normalizePixabay(body, kind) {
  const hits = Array.isArray(body.hits) ? body.hits : [];
  return {
    items: hits.slice(0, STOCK_PAGE_CAP).map((hit) => ({
      id: String(hit.id ?? ""),
      url: kind === "music" ? String(hit.previewURL ?? hit.url ?? "") : String(hit.previewURL ?? ""),
      license: "pixabay",
    })),
  };
}

async function handleAudio(req, env, url, kind) {
  if (!env.AUDIO_API_KEY || !env.AUDIO_API_URL) {
    return apiError("provider_misconfigured", "audio provider is not configured", 500);
  }
  const term = (url.searchParams.get(kind === "music" ? "mood" : "name") || "").trim().slice(0, 200);
  if (!term) {
    return apiError("bad_request", `missing ${kind === "music" ? "mood" : "name"}`, 400);
  }
  // NOTE: Pixabay serves music and sfx from API instances whose path is
  // configured via AUDIO_API_URL; keep the query contract stable here.
  const target =
    `${env.AUDIO_API_URL.replace(/\/$/, "")}/?key=${encodeURIComponent(env.AUDIO_API_KEY)}` +
    `&q=${encodeURIComponent(term)}&per_page=${STOCK_PAGE_CAP}`;
  const proxied = await forwardGet(target);
  if (!proxied.ok) return proxied;
  try {
    const body = await proxied.json();
    return json(normalizePixabay(body, kind), 200);
  } catch {
    return apiError("provider_transport", "audio provider returned invalid JSON", 502);
  }
}

export default {
  async fetch(req, env = {}) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ ok: true, version: VERSION });
    }

    if (req.method === "OPTIONS") {
      const cors = corsFor(req, env);
      if (!cors) return apiError("forbidden_origin", "origin not allowed", 403);
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-app-token",
          "access-control-max-age": "86400",
        },
      });
    }

    const cors = corsFor(req, env);
    if (!cors) return apiError("forbidden_origin", "origin not allowed", 403);

    // Every non-health route requires the app token (no user keys in browser).
    if (req.headers.get("x-app-token") !== env.APP_TOKEN || !env.APP_TOKEN) {
      return apiError("unauthorized", "missing or invalid app token", 401, cors);
    }

    const perMin = Math.max(1, Math.floor(Number(env.RATE_LIMIT_PER_MIN) || 60));
    const retryAfter = checkRateLimit(`${clientIp(req)}`, perMin);
    if (retryAfter > 0) {
      return json(
        { code: "rate_limited", message: "too many requests" },
        429,
        { ...cors, "retry-after": String(retryAfter) },
      );
    }

    const withCors = async (response) => {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    };

    if (req.method === "POST" && url.pathname === "/ai/chat") {
      return withCors(await handleChat(req, env));
    }
    if (req.method === "POST" && url.pathname === "/ai/respond") {
      return withCors(await handleRespond(req, env));
    }
    if (req.method === "GET" && url.pathname === "/stock/images") {
      return withCors(await handleStockImages(req, env, url));
    }
    if (req.method === "GET" && url.pathname === "/audio/music") {
      return withCors(await handleAudio(req, env, url, "music"));
    }
    if (req.method === "GET" && url.pathname === "/audio/sfx") {
      return withCors(await handleAudio(req, env, url, "sfx"));
    }
    return apiError("not_found", "unknown route", 404, cors);
  },
};
