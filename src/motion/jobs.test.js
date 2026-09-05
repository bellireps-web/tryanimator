import test from "node:test";
import assert from "node:assert/strict";
import {
  stableJson,
  extractJson,
  buildMotionPlanInput,
  createMotionJob,
  applyPatchOps,
  applyRevisionToChangedScenes,
  authoredEmptyIndexes,
  recordTurnStep,
  ProxyAiAdapter,
  runMotionJob,
} from "./jobs.js";

function codeOf(promise) {
  return promise.then(
    () => null,
    (error) => error && error.code,
  );
}

const RESOLUTION = {
  duration_secs: 10,
  scenes: [{ duration_secs: 10, brief: "opening", text: "Hi", transition: "fade" }],
};

function fakeAdapters(overrides = {}) {
  const calls = { renderer: 0, resolve: 0, author: 0 };
  const docs = new Map();
  const blobs = new Map();
  return {
    calls,
    ai: {
      resolveAuto: async () => {
        calls.resolve += 1;
        return JSON.parse(JSON.stringify(RESOLUTION));
      },
      authorScene: async () => {
        calls.author += 1;
        return "<doc/>";
      },
      chatPatch: async () => [{ op: "set_seed", seed: 5 }],
    },
    docs,
    images: { load: async (ref) => ({ ref }) },
    cache: {
      get: async (key) => blobs.get(key) || null,
      put: async (key, blob, bytes) => blobs.set(key, { blob, bytes }),
    },
    renderer: {
      renderSegments: async (plan, { onProgress, segments: segs }) => {
        calls.renderer += 1;
        onProgress(segs.length, segs.length);
        return { segments: segs.length };
      },
    },
    mux: null,
    validate: async () => {},
    ...overrides,
  };
}

function input(overrides = {}) {
  return buildMotionPlanInput({
    prompt: "  neon promo  ",
    ratio: "9:16",
    duration: "auto",
    style: "auto",
    brand: { colors: ["#7069AA"], font: "Figtree" },
    ...overrides,
  });
}

test("stableJson sorts keys", () => {
  assert.equal(stableJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

test("extractJson strips fences", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test("buildMotionPlanInput trims and defaults", () => {
  const built = buildMotionPlanInput({ prompt: " x ", ratio: "3:2" });
  assert.equal(built.prompt, "x");
  assert.equal(built.ratio, "9:16");
  assert.equal(built.duration, "auto");
  assert.deepEqual(built.brand.colors, ["#7069AA"]);
  const job = createMotionJob(built);
  assert.equal(job.state, "queued");
  assert.equal(job.type, "motion");
});

test("applyPatchOps covers all ops immutably", () => {
  const plan = {
    duration: 10,
    style: "auto",
    brand: { colors: ["#FFF"], font: "Figtree" },
    audio: { music_track_id: null, sfx: [] },
    seed: 1,
    scenes: [{ duration_secs: 10, text: "Hi" }],
  };
  const next = applyPatchOps(plan, [
    { op: "set_duration_secs", secs: 15 },
    { op: "set_brand", colors: ["#000"], font: "Lexend" },
    { op: "update_scene", index: 0, text: "Yo" },
    { op: "add_scene", index: 1 },
    { op: "remove_scene", index: 1 },
    { op: "set_music_track", track_id: "m9" },
    { op: "set_seed", seed: 42 },
  ]);
  assert.equal(next.duration, 15);
  assert.deepEqual(next.brand, { colors: ["#000"], font: "Lexend" });
  assert.equal(next.scenes[0].text, "Yo");
  assert.equal(next.scenes.length, 1);
  assert.equal(next.audio.music_track_id, "m9");
  assert.equal(next.seed, 42);
  assert.equal(plan.duration, 10, "input plan untouched");
  const syncCode = (fn) => {
    try {
      fn();
    } catch (error) {
      return error && error.code;
    }
    return null;
  };
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "remove_scene", index: 5 }])), "bad_op");
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "teleport" }])), "bad_op");
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "set_style_preset", id: "x", version: "y" }])), "bad_op");
  assert.equal(syncCode(() => applyPatchOps(plan, [{ op: "set_style_auto" }])), "bad_op");
});

test("ProxyAiAdapter requires config and parses fenced JSON", async () => {
  const bare = new ProxyAiAdapter({});
  assert.equal(await codeOf(bare.resolveAuto({})), "proxy_not_configured");

  const stub = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(RESOLUTION) + "\n```" } }] }), {
      status: 200,
    });
  const ai = new ProxyAiAdapter({ proxyBase: "https://proxy.test", appToken: "tok", fetchImpl: stub });
  assert.deepEqual(await ai.resolveAuto({ prompt: "x", ratio: "9:16" }), { ...RESOLUTION, thinking: "" });

  const bad = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ code: "unauthorized", message: "no" }), { status: 401 }),
  });
  assert.equal(await codeOf(bad.resolveAuto({})), "unauthorized");

  const empty = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  });
  assert.equal(await codeOf(empty.resolveAuto({})), "provider_invalid_output");
});

test("resolveAuto uses Responses with thinking, falls back without images", async () => {
  const seen = [];
  const payload = JSON.stringify(RESOLUTION);
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub(responsesBody({ text: payload, thinking: "tres escenas" }), seen),
  });
  assert.deepEqual(await ai.resolveAuto({ prompt: "x", ratio: "9:16" }), { ...RESOLUTION, thinking: "tres escenas" });
  assert.ok(seen[0].input.includes("target duration_secs"), "resolve travels as respond input");

  const legacy = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/ai/respond")) {
        return new Response(JSON.stringify({ id: "r", output: [{ type: "message", content: [] }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(RESOLUTION) } }] }),
        { status: 200 },
      );
    },
  });
  assert.deepEqual(await legacy.resolveAuto({ prompt: "x", ratio: "9:16" }), { ...RESOLUTION, thinking: "" });

  const seenChat = [];
  const withImages = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async (url, init) => {
      seenChat.push(String(url));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(RESOLUTION) } }] }),
        { status: 200 },
      );
    },
  });
  const out = await withImages.resolveAuto({ prompt: "x", ratio: "9:16", referenceImages: ["data:image/jpeg;base64,AAA"] });
  assert.equal(out.thinking, "");
  assert.ok(seenChat.every((u) => u.includes("/ai/chat")), "images stay on the multimodal chat path");
  assert.ok(!seenChat.some((u) => u.includes("/ai/respond")));
});

test("authorScene uses Responses and forwards temperature", async () => {
  const seen = [];
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub(responsesBody({ text: "<doc/>" }), seen),
  });
  assert.equal(await ai.authorScene({ prompt: "p", sceneBrief: "b", brand: {}, temperature: 0.2 }), "<doc/>");
  assert.equal(seen[0].temperature, 0.2);
  assert.equal(seen[0].max_output_tokens, 8192);
});

test("chat sends low reasoning effort by default", async () => {
  let sent = null;
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
  });
  await ai.chat([{ role: "user", content: "hi" }]);
  assert.equal(sent.reasoning_effort, "low");
  assert.equal("temperature" in sent, false, "temperature only when explicitly set");
  await ai.chat([{ role: "user", content: "hi" }], { temperature: 0.2 });
  assert.equal(sent.temperature, 0.2);
});

test("recordTurnStep logs transitions and merges close progress", () => {
  const steps = [];
  recordTurnStep(steps, { state: "resolving", progress: 0.05 }, 1000);
  recordTurnStep(steps, null);
  recordTurnStep(steps, { state: "rendering", progress: 0.5 }, 2000);
  recordTurnStep(steps, { state: "rendering", progress: 0.52 }, 2100);
  recordTurnStep(steps, { state: "done", progress: 1 }, 3000);
  assert.deepEqual(steps, [
    { state: "resolving", progress: 5, at: 1000 },
    { state: "rendering", progress: 52, at: 2000 },
    { state: "done", progress: 100, at: 3000 },
  ]);
  assert.equal(recordTurnStep("nope", { state: "x" }), "nope");
});

test("ProxyAiAdapter meters token usage for the trace", async () => {
  const usage = { prompt_tokens: 14, completion_tokens: 195, completion_tokens_details: { reasoning_tokens: 184 } };
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage }), { status: 200 }),
  });
  await ai.chat([{ role: "user", content: "hi" }]);
  await ai.chat([{ role: "user", content: "ho" }]);
  assert.deepEqual(ai.drainUsage(), { prompt_tokens: 28, completion_tokens: 390, reasoning_tokens: 368, cached_tokens: 0 });
  assert.deepEqual(ai.drainUsage(), { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 });
});

test("ProxyAiAdapter accumulates cached_tokens from both APIs", async () => {
  const chatUsage = { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 60 } };
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: chatUsage }), { status: 200 }),
  });
  await ai.chat([{ role: "user", content: "hi" }]);
  assert.equal(ai.drainUsage().cached_tokens, 60);
});

test("runMotionJob attaches AI usage to the result", async () => {
  const plain = createMotionJob(input());
  await runMotionJob(plain, fakeAdapters(), null);
  assert.equal(plain.result.usage, null, "adapters without metering stay null");

  const metered = fakeAdapters();
  metered.ai = { ...metered.ai, drainUsage: () => ({ prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 3 }) };
  const job = createMotionJob(input());
  await runMotionJob(job, metered, null);
  assert.deepEqual(job.result.usage, { prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 3 });
});

test("authoredEmptyIndexes lists scenes awaiting authoring", () => {
  assert.deepEqual(authoredEmptyIndexes(null), []);
  assert.deepEqual(
    authoredEmptyIndexes({ scenes: [
      { visual: { kind: "authored", doc_id: "doc/1" } },
      { visual: { kind: "authored", doc_id: "" } },
      { visual: { kind: "stock", query: "x" } },
      {},
    ] }),
    [1],
  );
});

test("ProxyAiAdapter retries authoring once on empty responses", async () => {
  let calls = 0;
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => {
      calls += 1;
      const content = calls === 1 ? "   " : "<doc/>rebuilt";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  assert.equal(await ai.authorScene({ prompt: "p", sceneBrief: "b", brand: {} }), "<doc/>rebuilt");
  assert.equal(calls, 2);

  const dead = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  });
  assert.equal(await codeOf(dead.authorScene({ prompt: "p", sceneBrief: "b", brand: {} })), "provider_invalid_output");
});

test("ProxyAiAdapter attaches reference images as multimodal parts", async () => {
  let sent = null;
  const stub = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(RESOLUTION) + "\n```" } }] }), {
      status: 200,
    });
  };
  const ai = new ProxyAiAdapter({ proxyBase: "https://proxy.test", appToken: "tok", fetchImpl: stub });
  const images = ["data:image/jpeg;base64,AAA", "data:image/png;base64,BBB", "blob:http://local/1"];
  await ai.resolveAuto({ prompt: "x", ratio: "9:16", referenceImages: images });
  const last = sent.messages[sent.messages.length - 1];
  assert.ok(Array.isArray(last.content), "last turn becomes parts");
  assert.equal(last.content[0].type, "text");
  assert.ok(typeof last.content[0].text === "string");
  assert.deepEqual(
    last.content.filter((p) => p.type === "image_url").map((p) => p.image_url.url),
    ["data:image/jpeg;base64,AAA", "data:image/png;base64,BBB"],
    "only data: URLs, capped and in order",
  );

  // Without images the contract stays plain strings.
  await ai.resolveAuto({ prompt: "x", ratio: "9:16" });
  assert.equal(typeof sent.messages[sent.messages.length - 1].content, "string");
});

test("buildMotionPlanInput keeps references and seeds them into cache keys", async () => {
  const a = buildMotionPlanInput({ prompt: "promo", ratio: "9:16", referenceImages: ["data:image/jpeg;base64,AAA"] });
  const b = buildMotionPlanInput({ prompt: "promo", ratio: "9:16", referenceImages: ["data:image/jpeg;base64,BBB"] });
  const c = buildMotionPlanInput({ prompt: "promo", ratio: "9:16" });
  assert.equal(a.referenceImages.length, 1);
  assert.equal(c.referenceImages.length, 0);
  assert.notEqual(a.seed, b.seed, "different refs must not share renders");
  const many = buildMotionPlanInput({ prompt: "p", ratio: "9:16", referenceImages: [1, 2, 3, 4, 5, 6].map((n) => `data:image/jpeg;base64,${n}`) });
  assert.equal(many.referenceImages.length, 4);
  const v1 = buildMotionPlanInput({ prompt: "p", ratio: "9:16", referenceVideoKey: "a.mp4:123:10" });
  const v2 = buildMotionPlanInput({ prompt: "p", ratio: "9:16", referenceVideoKey: "b.mp4:123:10" });
  assert.notEqual(v1.seed, v2.seed, "different reference videos must not share renders");
  assert.equal(v1.referenceVideoKey, "a.mp4:123:10");
});

test("runMotionJob happy path with state sequence", async () => {
  const job = createMotionJob(input());
  const seen = [];
  const adapters = fakeAdapters();
  await runMotionJob(job, adapters, (snapshot) => seen.push(snapshot.state));
  assert.equal(job.state, "done");
  assert.equal(job.progress, 1);
  assert.equal(job.result.plan.scenes.length, 1);
  assert.ok(job.result.plan.scenes[0].visual.doc_id.startsWith("doc/"), "content-addressed doc id");
  assert.equal(job.result.muxPending, true);
  assert.deepEqual(seen[0], "resolving");
  assert.ok(seen.includes("authoring"));
  assert.ok(seen.includes("rendering"));
  assert.equal(adapters.calls.renderer, 1);

  // Rerun hits the final cache only if a video was stored; without mux the
  // renderer runs again but the plan path is identical and deterministic.
  const again = createMotionJob(input());
  await runMotionJob(again, adapters, null);
  assert.equal(again.state, "done");
  assert.equal(
    again.result.plan.scenes[0].visual.doc_id,
    job.result.plan.scenes[0].visual.doc_id,
    "identical inputs share doc ids",
  );
});

test("runMotionJob caches final video on hit", async () => {
  const adapters = fakeAdapters();
  const first = createMotionJob(input());
  // Fake mux stores bytes so the second run short-circuits.
  adapters.mux = {
    mux: async () => new Uint8Array([1, 2, 3]),
  };
  await runMotionJob(first, adapters, null);
  assert.equal(first.state, "done");
  assert.equal(adapters.calls.renderer, 1);
  const second = createMotionJob(input());
  await runMotionJob(second, adapters, null);
  assert.equal(second.state, "done");
  assert.equal(second.result.cached, true);
  assert.equal(adapters.calls.renderer, 1, "renderer skipped on cache hit");
});

test("runMotionJob fails structured on AI error", async () => {
  const job = createMotionJob(input());
  const adapters = fakeAdapters({
    ai: {
      resolveAuto: async () => {
        const error = new Error("nope");
        error.code = "proxy_not_configured";
        throw error;
      },
      authorScene: async () => "",
      chatPatch: async () => [],
    },
  });
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "proxy_not_configured");
});

test("runMotionJob rejects empty prompt", async () => {
  const job = createMotionJob(input({ prompt: "   " }));
  await runMotionJob(job, fakeAdapters(), null);
  assert.equal(job.state, "failed");
  assert.equal(job.error.code, "bad_request");
});

test("applyRevisionToChangedScenes invalidates touched docs with the user text", () => {
  const prev = {
    brand: { colors: ["#FFF"], font: "Figtree" },
    scenes: [{ duration_secs: 5, brief: "neon jelly", text: "Hi", visual: { kind: "authored", doc_id: "doc/1" } }],
  };
  const same = applyRevisionToChangedScenes(prev, JSON.parse(JSON.stringify(prev)), "quitale el neon");
  assert.equal(same.scenes[0].visual.doc_id, "", "fallback re-authors when ops encoded nothing");
  assert.equal(same.scenes[0].revision, "quitale el neon");

  const changed = JSON.parse(JSON.stringify(prev));
  changed.scenes[0].text = "Bye";
  const next = applyRevisionToChangedScenes(prev, changed, "quitale el neon");
  assert.equal(next.scenes[0].visual.doc_id, "");
  assert.equal(next.scenes[0].revision, "quitale el neon");
  assert.equal(next.scenes[0].text, "Bye");

  const branded = JSON.parse(JSON.stringify(prev));
  branded.brand = { colors: ["#000"], font: "Lexend" };
  const reb = applyRevisionToChangedScenes(prev, branded, "oscuro");
  assert.equal(reb.scenes[0].visual.doc_id, "", "brand change rebuilds docs");

  const stock = {
    brand: prev.brand,
    scenes: [{ duration_secs: 5, brief: "city", text: "Hi", visual: { kind: "stock", query: "neon" } }],
  };
  const kept = applyRevisionToChangedScenes(stock, JSON.parse(JSON.stringify(stock)), "nada");
  assert.equal(kept.scenes[0].visual.query, "neon", "untouched stock visuals survive");
  assert.equal(kept.scenes[0].revision, undefined);
});

test("applyRevisionToChangedScenes attaches the previous doc for true edits", () => {
  const prev = {
    brand: { colors: ["#FFF"], font: "Figtree" },
    scenes: [{ duration_secs: 5, brief: "neon jelly", text: "Hi", visual: { kind: "authored", doc_id: "doc/1" } }],
  };
  const docs = new Map([["doc/1", "<div>old jelly</div>"]]);
  const changed = JSON.parse(JSON.stringify(prev));
  changed.scenes[0].text = "Bye";
  const next = applyRevisionToChangedScenes(prev, changed, "quitale el neon", (id) => docs.get(id));
  assert.equal(next.scenes[0].visual.doc_id, "");
  assert.equal(next.scenes[0].previousDoc, "<div>old jelly</div>");

  const noGetter = applyRevisionToChangedScenes(prev, changed, "quitale el neon");
  assert.equal(noGetter.scenes[0].previousDoc, undefined);
});

test("runMotionJob forwards chat revisions to authoring and strips them", async () => {
  const seen = [];
  const adapters = fakeAdapters({
    ai: {
      resolveAuto: async () => ({ duration_secs: 5, scenes: [{ duration_secs: 5, brief: "a", text: "t", transition: "cut" }] }),
      authorScene: async (args) => {
        seen.push(args);
        return "<doc/>";
      },
      chatPatch: async () => [],
    },
  });
  const base = {
    duration: 5,
    style: "free",
    brand: { colors: ["#FFF"], font: "Figtree" },
    audio: { music_track_id: null, sfx: [] },
    seed: 1,
    scenes: [{ duration_secs: 5, brief: "a", text: "t", transition: "cut", visual: { kind: "authored", doc_id: "" }, revision: "sin neon" }],
  };
  const job = createMotionJob(input({ duration: 5 }));
  job.basePlan = base;
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "done");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].revision, "sin neon");
  assert.equal(seen[0].temperature, 0.2, "edits run cooler for fidelity");
  assert.equal(job.result.plan.scenes[0].revision, undefined, "revision never leaks into cache keys");
  assert.ok(job.result.plan.scenes[0].visual.doc_id.startsWith("doc/"));

  const withPrev = JSON.parse(JSON.stringify(base));
  withPrev.scenes[0].previousDoc = "<div>old</div>";
  withPrev.scenes[0].visual.doc_id = "";
  const job2 = createMotionJob(input({ duration: 5 }));
  job2.basePlan = withPrev;
  await runMotionJob(job2, adapters, null);
  assert.equal(job2.state, "done");
  assert.equal(seen[seen.length - 1].currentDoc, "<div>old</div>");
  assert.equal(job2.result.plan.scenes[0].previousDoc, undefined, "previousDoc never leaks into cache keys");
});

test("runMotionJob attaches resolve thinking to the result", async () => {
  const adapters = fakeAdapters({
    ai: {
      resolveAuto: async () => ({ ...JSON.parse(JSON.stringify(RESOLUTION)), thinking: "una escena" }),
      authorScene: async () => "<doc/>",
      chatPatch: async () => [],
    },
  });
  const job = createMotionJob(input());
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "done");
  assert.equal(job.result.thinking, "una escena");
});
test("runMotionJob honors basePlan without AI (chat re-render)", async () => {
  const adapters = fakeAdapters();
  const first = createMotionJob(input());
  await runMotionJob(first, adapters, null);
  assert.equal(first.state, "done");
  const resolvedCalls = adapters.calls.resolve;

  const patched = applyPatchOps(first.result.plan, [{ op: "set_seed", seed: 9 }]);
  const job = createMotionJob(input());
  job.basePlan = patched;
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "done");
  assert.equal(job.result.plan.seed, 9);
  assert.equal(adapters.calls.resolve, resolvedCalls, "no AI on re-render");
  assert.ok(job.result.plan.scenes[0].visual.doc_id, "doc ids preserved");
});

const TWO_SCENES = [
  { duration_secs: 3, brief: "open", text: "Hi", transition: "fade" },
  { duration_secs: 2, brief: "close", text: "Bye", transition: "cut" },
];

function multiAdapters(overrides = {}) {
  const base = fakeAdapters();
  base.ai = {
    resolveAuto: async () => {
      base.calls.resolve += 1;
      return { duration_secs: 5, scenes: JSON.parse(JSON.stringify(TWO_SCENES)) };
    },
    authorScene: async () => {
      base.calls.author += 1;
      return '<div class="a">Hi</div><div class="b">Yo</div><script>gsap.from(".a",{opacity:0});gsap.from(".b",{y:10});</script>';
    },
    chatPatch: async () => [],
  };
  return Object.assign(base, overrides);
}

test("runMotionJob merges to one scene unless asked otherwise", async () => {
  const single = createMotionJob(input({ prompt: "un gato astronauta", duration: 5 }));
  await runMotionJob(single, multiAdapters(), null);
  assert.equal(single.state, "done");
  assert.equal(single.result.plan.scenes.length, 1);
  assert.equal(single.result.plan.scenes[0].duration_secs, 5);

  const multi = createMotionJob(input({ prompt: "dos escenas: apertura y cierre", duration: 5 }));
  await runMotionJob(multi, multiAdapters(), null);
  assert.equal(multi.state, "done");
  assert.equal(multi.result.plan.scenes.length, 2);
});

test("runMotionJob retries authoring once on a static doc", async () => {
  const staticAdapters = multiAdapters({ authored: { score: async () => 0 } });
  const job = createMotionJob(input({ prompt: "algo con movimiento", duration: 5 }));
  await runMotionJob(job, staticAdapters, null);
  assert.equal(job.state, "done");
  assert.equal(staticAdapters.calls.author, 2, "one retry after static score");

  const livelyAdapters = multiAdapters({ authored: { score: async () => 0.5, spreadScore: async () => ({ minWindow: 0.02, build: 0.2 }) } });
  const fine = createMotionJob(input({ prompt: "algo con movimiento", duration: 5 }));
  await runMotionJob(fine, livelyAdapters, null);
  assert.equal(fine.state, "done");
  assert.equal(livelyAdapters.calls.author, 1, "no retry when motion is present");
});

test("runMotionJob retries once when entrances are missing", async () => {
  const seenArgs = [];
  const noEntrance = multiAdapters({ authored: { score: async () => 0.5 } });
  noEntrance.ai.authorScene = async (args) => {
    noEntrance.calls.author += 1;
    seenArgs.push(args);
    return "<div>full static layout</div>";
  };
  const job = createMotionJob(input({ prompt: "chart", duration: 5 }));
  await runMotionJob(job, noEntrance, null);
  assert.equal(job.state, "done");
  assert.equal(noEntrance.calls.author, 2, "one retry for missing entrances");
  assert.equal(seenArgs[1].currentDoc, undefined, "entrance retry rebuilds from scratch");
  assert.match(seenArgs[1].sceneBrief, /CRITICAL/);
  assert.match(seenArgs[1].sceneBrief, /time 0/);
});

test("runMotionJob records gate reports on the job", async () => {
  const lively = multiAdapters({ authored: { score: async () => 0.5, spreadScore: async () => ({ minWindow: 0.02, build: 0.2 }) } });
  const job = createMotionJob(input({ prompt: "algo con movimiento", duration: 5 }));
  await runMotionJob(job, lively, null);
  assert.equal(job.state, "done");
  assert.deepEqual(job.gateReports, [{ scene: 0, attempts: 1, problems: [] }]);

  const seenArgs = [];
  const dangling = multiAdapters({
    authored: { score: async () => 0.5, spreadScore: async () => ({ minWindow: 0.02, build: 0.2 }) },
  });
  dangling.ai.authorScene = async (args) => {
    dangling.calls.author += 1;
    seenArgs.push(args);
    return '<div id="ok">Hi</div><script>gsap.from("#ok",{opacity:0});gsap.from("#ghost",{opacity:0});</script>';
  };
  const job2 = createMotionJob(input({ prompt: "chart", duration: 5 }));
  await runMotionJob(job2, dangling, null);
  assert.equal(dangling.calls.author, 2, "one retry for dangling selectors");
  assert.equal(job2.gateReports.length, 1);
  assert.equal(job2.gateReports[0].attempts, 2);
  assert.match(job2.gateReports[0].problems.join(";"), /missing selectors/);
  assert.match(seenArgs[1].sceneBrief, /missing selectors/);
  assert.match(seenArgs[1].sceneBrief, /#ghost/);
});

test("runMotionJob retries once when the opening stays empty", async () => {
  const seenArgs = [];
  const backLoaded = multiAdapters({ authored: { score: async () => 0.5, spreadScore: async () => ({ minWindow: 0.01, build: 0.005 }) } });
  backLoaded.ai.authorScene = async (args) => {
    backLoaded.calls.author += 1;
    seenArgs.push(args);
    return '<div class="a">Hi</div><script>gsap.from(".a",{opacity:0});gsap.from(".b",{y:10});</script>';
  };
  const job = createMotionJob(input({ prompt: "chart", duration: 5 }));
  await runMotionJob(job, backLoaded, null);
  assert.equal(job.state, "done");
  assert.equal(backLoaded.calls.author, 2, "one retry for back-loaded pacing");
  assert.match(seenArgs[1].sceneBrief, /first half/);
});

test("runMotionJob authors a backdrop when stock search fails", async () => {
  const adapters = fakeAdapters({
    ai: {
      resolveAuto: async () => ({
        duration_secs: 5,
        scenes: [{ duration_secs: 5, brief: "city night", text: "Hi", transition: "cut", visual: { kind: "stock", query: "city" } }],
      }),
      authorScene: async () => "<doc/>backdrop",
      chatPatch: async () => [],
    },
    images: {
      load: async (ref) => {
        const error = new Error("no provider");
        error.code = "provider_misconfigured";
        throw error;
      },
    },
  });
  const job = createMotionJob(input({ prompt: "city night", duration: 5 }));
  await runMotionJob(job, adapters, null);
  assert.equal(job.state, "done");
  assert.equal(job.result.plan.scenes[0].visual.kind, "authored");
  assert.ok(job.result.plan.scenes[0].visual.doc_id.startsWith("doc/"));
});

function responsesBody({ text = "", thinking = "", reasoningTokens = 0 } = {}) {
  return {
    id: "resp_1",
    status: "completed",
    output: [
      ...(thinking ? [{ type: "reasoning", summary: [{ type: "summary_text", text: thinking }] }] : []),
      { type: "message", content: [{ type: "output_text", text }] },
    ],
    usage: { input_tokens: 10, output_tokens: 20, output_tokens_details: { reasoning_tokens: reasoningTokens } },
  };
}

function responsesStub(body, seen) {
  return async (url, init) => {
    if (String(url).includes("/ai/respond")) {
      if (seen) seen.push(JSON.parse(init.body));
      return new Response(JSON.stringify(typeof body === "function" ? body() : body), { status: 200 });
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test("respond() splits visible text from thinking and meters usage", async () => {
  const seen = [];
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub(responsesBody({ text: "hola", thinking: "porque sí", reasoningTokens: 7 }), seen),
  });
  assert.deepEqual(await ai.respond({ input: "hi" }), { text: "hola", thinking: "porque sí" });
  assert.deepEqual(ai.drainUsage(), { prompt_tokens: 10, completion_tokens: 20, reasoning_tokens: 7, cached_tokens: 0 });
  assert.equal(seen[0].store, false);
  assert.deepEqual(seen[0].reasoning, { effort: "low", summary: "concise" });

  const empty = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub({ id: "resp_2", output: [] }),
  });
  assert.deepEqual(await empty.respond({ input: "hi" }), { text: "", thinking: "" });

  const broken = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub({ nope: true }),
  });
  await assert.rejects(broken.respond({ input: "hi" }), /malformed/);
});

test("chatPatch forwards thread history into the respond input", async () => {
  const seen = [];
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub(
      responsesBody({ text: JSON.stringify({ ops: [], message: "Ok." }), thinking: "t" }),
      seen,
    ),
  });
  await ai.chatPatch("{}", "más rayos", "user: tormenta");
  assert.match(seen[0].input, /conversation so far/);
  assert.match(seen[0].input, /user: tormenta/);
});

test("chatPatch returns ops, human words and thinking via Responses", async () => {
  const payload = JSON.stringify({ ops: [{ op: "set_seed", seed: 5 }], message: "Listo, cielo nocturno." });
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: responsesStub(responsesBody({ text: payload, thinking: "cambio mínimo" })),
  });
  assert.deepEqual(await ai.chatPatch("{}", "cambia el cielo"), {
    ops: [{ op: "set_seed", seed: 5 }],
    message: "Listo, cielo nocturno.",
    thinking: "cambio mínimo",
  });
});

test("chatPatch falls back to chat completions without thinking", async () => {
  const ai = new ProxyAiAdapter({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/ai/respond")) {
        return new Response(JSON.stringify({ id: "r", output: [{ type: "message", content: [] }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ops: [] }) } }] }),
        { status: 200 },
      );
    },
  });
  assert.deepEqual(await ai.chatPatch("{}", "hola"), { ops: [], message: "", thinking: "" });
});
