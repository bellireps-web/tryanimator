/**
 * Slice 7 — end-to-end Motion pipeline in Node.
 *
 * Real modules: runMotionJob state machine, MotionCache (memory backend),
 * segment renderer orchestration + key math, mux orchestration, image
 * loader mapping, auto validation. Stubbed only at the browser boundary:
 * AI proxy, stock HTTP, image elements, frame encoder, mediabunny.
 * Browser codecs (WebCodecs encode, real MP4 bytes) need a real browser
 * and stay a documented QA gap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMotionJob, buildMotionPlanInput, runMotionJob } from "./jobs.js";
import { createSegmentRenderer, createImageLoader, createMuxer } from "./browser.js";
import { MotionCache, MemoryBackend } from "../cache/store.js";

globalThis.EncodedVideoChunk =
  globalThis.EncodedVideoChunk ||
  class {
    constructor(init) {
      Object.assign(this, init);
    }
  };
globalThis.EncodedAudioChunk =
  globalThis.EncodedAudioChunk ||
  class {
    constructor(init) {
      Object.assign(this, init);
    }
  };

const RESOLUTION = {
  duration_secs: 30,
  style_id: "kinetic-type",
  style_version: "1.0.0",
  scenes: [
    {
      duration_secs: 15,
      brief: "opening hook",
      text: "NEON",
      transition: "fade",
      visual: { kind: "stock", query: "neon city" },
    },
    {
      duration_secs: 15,
      brief: "payoff",
      text: "PROMO",
      transition: "cut",
    },
  ],
};

function fakeMedia() {
  const calls = { video: [], finalized: 0 };
  return {
    calls,
    Output: class {
      constructor({ target }) {
        this.target = target;
      }
      addVideoTrack() {}
      addAudioTrack() {}
      async start() {}
      async finalize() {
        calls.finalized += 1;
        this.target.buffer = new Uint8Array([77, 80, 52]).buffer;
      }
    },
    Mp4OutputFormat: class {},
    BufferTarget: class {},
    EncodedVideoPacketSource: class {
      async add(packet) {
        calls.video.push(packet);
      }
    },
    EncodedAudioPacketSource: class {
      async add() {}
    },
    EncodedPacket: { fromEncodedChunk: (chunk) => ({ wrapped: chunk }) },
  };
}

function buildAdapters({ media, muxEnabled = true, counter }) {
  const cache = new MotionCache(new MemoryBackend());
  const encode = async (plan, seg) => {
    counter.calls += 1;
    const chunks = [];
    for (let i = 0; i < seg.frameCount; i++) {
      chunks.push({
        data: new Uint8Array([seg.index, i % 256]),
        type: i === 0 ? "key" : "delta",
        timestamp: (seg.startFrame + i) * 1000,
        duration: 1000,
      });
    }
    return { chunks, keyframes: 1 };
  };
  return {
    counter,
    ai: {
      resolveAuto: async () => JSON.parse(JSON.stringify(RESOLUTION)),
      authorScene: async () => "<section><h1>payoff</h1></section>",
      chatPatch: async () => [{ op: "set_seed", seed: 5 }],
    },
    docs: new Map(),
    images: createImageLoader({
      proxyBase: "https://proxy.test",
      appToken: "tok",
      fetchImpl: async () => new Response(JSON.stringify({ hits: [{ previewURL: "https://img.test/1.jpg" }] }), { status: 200 }),
      loadElement: async () => ({ width: 16, height: 9 }),
    }),
    cache,
    renderer: createSegmentRenderer({ encode, createCanvas: (w, h) => ({ width: w, height: h }) }),
    mux: muxEnabled ? createMuxer({ media }) : null,
    validate: null,
  };
}

function input() {
  return buildMotionPlanInput({
    prompt: "neon promo for launch",
    ratio: "9:16",
    duration: "auto",
    style: "auto",
    brand: { colors: ["#7069AA", "#B8B2EE"], font: "Figtree" },
  });
}

test("motion E2E: prompt to mp4 bytes with segment resume and final cache", async () => {
  const media = fakeMedia();
  const counter = { calls: 0 };

  // Pass 1 without mux: resolves, renders 2 segments (30s @30fps, 600 max).
  const rendering = buildAdapters({ media, muxEnabled: false, counter });
  const first = createMotionJob(input());
  await runMotionJob(first, rendering, null);
  assert.equal(first.state, "done");
  assert.equal(first.result.muxPending, true);
  assert.equal(first.result.segmentStats.segments.length, 2);
  assert.equal(counter.calls, 2);
  assert.deepEqual(first.result.plan.scenes[0].visual, { kind: "stock", query: "neon city" });
  assert.equal(first.result.plan.scenes[1].visual.kind, "authored");
  assert.ok(first.result.plan.scenes[1].visual.doc_id.startsWith("doc/"), "authored doc id assigned");
  assert.equal(first.result.plan.style.id, "kinetic-type");

  // Pass 2 with mux, same cache: segments reused, mp4 bytes produced.
  const muxed = buildAdapters({ media, muxEnabled: true, counter });
  muxed.cache = rendering.cache;
  const second = createMotionJob(input());
  await runMotionJob(second, muxed, null);
  assert.equal(second.state, "done");
  assert.equal(counter.calls, 2, "segments reused from cache");
  assert.ok(second.result.video instanceof Uint8Array);
  assert.deepEqual([...second.result.video], [77, 80, 52]);
  assert.equal(media.calls.video.length, 900, "every frame muxed in order");
  assert.equal(media.calls.video[0].wrapped.timestamp, 0);

  // Pass 3: final cache hit skips renderer and mux entirely.
  const third = createMotionJob(input());
  await runMotionJob(third, muxed, null);
  assert.equal(third.state, "done");
  assert.equal(third.result.cached, true);
  assert.equal(counter.calls, 2);
  assert.equal(media.calls.finalized, 1, "mux ran once");
});
