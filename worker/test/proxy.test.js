import test from "node:test";
import assert from "node:assert/strict";
import handler, { resetRateLimits } from "../src/index.js";

const BASE = "https://proxy.test";
const ENV = {
  APP_TOKEN: "secret-app-token",
  META_API_KEY: "meta-key",
  STOCK_API_KEY: "stock-key",
  STOCK_API_URL: "https://stock.example/v1",
  AUDIO_API_KEY: "audio-key",
  AUDIO_API_URL: "https://audio.example/api",
  ALLOWED_ORIGIN: "http://localhost:3000",
  RATE_LIMIT_PER_MIN: "1000",
};

function req(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { origin: "http://localhost:3000", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authed(path, options = {}) {
  return req(path, {
    ...options,
    headers: { ...(options.headers || {}), "x-app-token": ENV.APP_TOKEN },
  });
}

let lastFetch = null;
function stubFetch(handlerFn) {
  lastFetch = null;
  globalThis.fetch = async (url, init) => {
    lastFetch = { url: String(url), init };
    return handlerFn(url, init);
  };
}

test.beforeEach(() => {
  resetRateLimits();
});

test("health needs no token", async () => {
  const res = await handler.fetch(req("/health"), ENV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, version: "0.1.0" });
});

test("forbidden origin is rejected", async () => {
  const res = await handler.fetch(
    req("/audio/music?mood=x", { headers: { origin: "https://evil.test" } }),
    ENV,
  );
  assert.equal(res.status, 403);
});

test("missing app token is 401", async () => {
  const res = await handler.fetch(req("/audio/music?mood=epic"), ENV);
  assert.equal(res.status, 401);
});

test("unknown route is structured 404", async () => {
  const res = await handler.fetch(authed("/nope"), ENV);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "not_found");
});

test("chat forwards with injected key and strips client auth", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ choices: [] }), {
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const res = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        headers: { authorization: "Bearer attacker" },
        body: { model: "muse-spark-1.3", messages: [{ role: "user", content: "hi" }] },
      }),
      ENV,
    );
    assert.equal(res.status, 200);
    assert.match(lastFetch.url, /^https:\/\/api\.meta\.ai\/v1\/chat\/completions$/);
    assert.equal(lastFetch.init.headers.authorization, "Bearer meta-key");
    const sent = JSON.parse(lastFetch.init.body);
    assert.equal(sent.model, "muse-spark-1.3");
    assert.deepEqual(sent.messages, [{ role: "user", content: "hi" }]);
  } finally {
    delete globalThis.fetch;
  }
});

test("chat caps max_tokens and rejects other models", async () => {
  stubFetch(() => new Response("{}", { headers: { "content-type": "application/json" } }));
  try {
    const res = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        body: {
          model: "muse-spark-1.3",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 99999,
        },
      }),
      ENV,
    );
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(lastFetch.init.body).max_tokens, 8192);

    const bad = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      }),
      ENV,
    );
    assert.equal(bad.status, 400);
  } finally {
    delete globalThis.fetch;
  }
});

test("chat maps upstream 401/429/timeout", async () => {
  stubFetch(() => new Response("nope", { status: 401 }));
  try {
    const denied = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        body: { model: "muse-spark-1.3", messages: [{ role: "user", content: "hi" }] },
      }),
      ENV,
    );
    assert.equal(denied.status, 502);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.code, "provider_unauthorized");
    assert.match(deniedBody.message, /nope/, "upstream reason is surfaced");
  } finally {
    delete globalThis.fetch;
  }

  stubFetch(() => new Response("slow", { status: 429, headers: { "retry-after": "7" } }));
  try {
    const limited = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        body: { model: "muse-spark-1.3", messages: [{ role: "user", content: "hi" }] },
      }),
      ENV,
    );
    assert.equal(limited.status, 502);
    assert.equal(limited.headers.get("retry-after"), "7");
  } finally {
    delete globalThis.fetch;
  }

  globalThis.fetch = () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  try {
    const timedOut = await handler.fetch(
      authed("/ai/chat", {
        method: "POST",
        body: { model: "muse-spark-1.3", messages: [{ role: "user", content: "hi" }] },
      }),
      ENV,
    );
    assert.equal(timedOut.status, 504);
  } finally {
    delete globalThis.fetch;
  }
});

test("rate limit trips and carries retry-after", async () => {
  stubFetch(
    () =>
      new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const env = { ...ENV, RATE_LIMIT_PER_MIN: "2" };
    assert.equal((await handler.fetch(authed("/stock/images?q=x"), env)).status, 200);
    assert.equal((await handler.fetch(authed("/stock/images?q=x"), env)).status, 200);
    const limited = await handler.fetch(authed("/stock/images?q=x"), env);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  } finally {
    delete globalThis.fetch;
  }
});

test("stock injects key and caps paging", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ items: [] }), {
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const res = await handler.fetch(authed("/stock/images?q=neon&per_page=500"), ENV);
    assert.equal(res.status, 200);
    assert.match(lastFetch.url, /per_page=25/);
    assert.equal(lastFetch.init.headers.authorization, "Bearer stock-key");
  } finally {
    delete globalThis.fetch;
  }
});

test("audio normalizes pixabay shape without leaking key", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ hits: [{ id: 42, previewURL: "https://cdn/audio.mp3" }] }), {
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const res = await handler.fetch(authed("/audio/music?mood=epic"), ENV);
    assert.equal(res.status, 200);
    assert.match(lastFetch.url, /key=audio-key/);
    assert.deepEqual(await res.json(), {
      items: [{ id: "42", url: "https://cdn/audio.mp3", license: "pixabay" }],
    });
  } finally {
    delete globalThis.fetch;
  }
});
