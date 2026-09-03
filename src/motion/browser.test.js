import test from "node:test";
import assert from "node:assert/strict";
import {
  pickStockUrl,
  createImageLoader,
  createSegmentRenderer,
  createMuxer,
  createBrowserAdapters,
} from "./browser.js";
import { MotionCache, MemoryBackend } from "../cache/store.js";

function codeOf(promise) {
  return promise.then(
    () => null,
    (error) => error && error.code,
  );
}

class FakeChunk {
  constructor(init) {
    Object.assign(this, init);
  }
}
globalThis.EncodedVideoChunk = globalThis.EncodedVideoChunk || FakeChunk;
globalThis.EncodedAudioChunk = globalThis.EncodedAudioChunk || FakeChunk;

function fakeMedia() {
  const calls = { video: [], audio: [], finalized: 0, tracks: [] };
  return {
    calls,
    Output: class {
      constructor({ target }) {
        this.target = target;
      }
      addVideoTrack(source, options) {
        calls.tracks.push(["video", options]);
        this.video = source;
      }
      addAudioTrack(source) {
        calls.tracks.push(["audio"]);
        this.audio = source;
      }
      async start() {}
      async finalize() {
        calls.finalized += 1;
        this.target.buffer = new Uint8Array([9, 9]).buffer;
      }
    },
    Mp4OutputFormat: class {},
    BufferTarget: class {},
    EncodedVideoPacketSource: class {
      constructor(codec) {
        this.codec = codec;
      }
      async add(packet) {
        calls.video.push(packet);
      }
    },
    EncodedAudioPacketSource: class {
      async add(packet) {
        calls.audio.push(packet);
      }
    },
    EncodedPacket: { fromEncodedChunk: (chunk) => ({ wrapped: chunk }) },
  };
}

const SEGMENTS = [
  { index: 0, startFrame: 0, frameCount: 2 },
  { index: 1, startFrame: 2, frameCount: 2 },
];

function stubEncode(counter) {
  return async (plan, seg) => {
    counter.calls += 1;
    return {
      keyframes: 1,
      chunks: [
        {
          data: new Uint8Array([seg.index]),
          type: "key",
          timestamp: seg.startFrame * 1000,
          duration: 1000,
        },
      ],
    };
  };
}

test("pickStockUrl prefers previewURL then normalized items", () => {
  assert.equal(pickStockUrl({ hits: [{ previewURL: "a" }] }), "a");
  assert.equal(pickStockUrl({ hits: [{ largeImageURL: "b" }] }), "b");
  assert.equal(pickStockUrl({ items: [{ url: "c" }] }), "c");
  assert.equal(pickStockUrl({ hits: [] }), null);
  assert.equal(pickStockUrl(null), null);
});

test("image loader searches stock via proxy, passes direct URLs", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push([url, options && options.headers]);
    return new Response(JSON.stringify({ hits: [{ previewURL: "https://img.test/1.jpg" }] }), { status: 200 });
  };
  const loaded = [];
  const loader = createImageLoader({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl,
    loadElement: async (url) => {
      loaded.push(url);
      return { width: 8, height: 8 };
    },
  });
  const drawable = await loader.load("stock:neon city");
  assert.equal(drawable.width, 8);
  assert.ok(seen[0][0].startsWith("https://proxy.test/stock/images?q=neon%20city"));
  assert.equal(seen[0][1]["x-app-token"], "tok");
  assert.deepEqual(loaded, ["https://img.test/1.jpg"]);

  const direct = await loader.load("blob:local-upload");
  assert.equal(direct.width, 8);
  assert.deepEqual(loaded[1], "blob:local-upload");

  assert.equal(await codeOf(loader.load("stock:   ")), "bad_request");
  const empty = createImageLoader({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }),
    loadElement: async () => ({ width: 1, height: 1 }),
  });
  assert.equal(await codeOf(empty.load("stock:nothing-here")), "stock_empty");
});

test("segment renderer encodes, caches, and reuses across jobs", async () => {
  const cache = new MotionCache(new MemoryBackend());
  const counter = { calls: 0 };
  const renderer = createSegmentRenderer({
    encode: stubEncode(counter),
    createCanvas: (w, h) => ({ width: w, height: h }),
  });
  const images = new Map();
  const plan = { fps: 30 };
  const progress = [];
  const first = await renderer.renderSegments(plan, {
    dims: [608, 1080],
    images,
    segments: SEGMENTS,
    cache,
    planKey: "plan-a",
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(counter.calls, 2);
  assert.deepEqual(
    first.segments.map((stat) => stat.index),
    [0, 1],
  );
  assert.equal(first.packets.length, 2);
  assert.deepEqual([first.packets[0].data[0], first.packets[1].data[0]], [0, 1]);
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);

  // Second job, same plan key: encoder untouched, bytes identical.
  const second = await renderer.renderSegments(plan, {
    dims: [608, 1080],
    images,
    segments: SEGMENTS,
    cache,
    planKey: "plan-a",
    onProgress: null,
  });
  assert.equal(counter.calls, 2, "segments served from cache");
  assert.deepEqual(
    second.packets.map((packet) => packet.data[0]),
    [0, 1],
  );

  // Different plan key re-encodes.
  await renderer.renderSegments(plan, {
    dims: [608, 1080],
    images,
    segments: SEGMENTS,
    cache,
    planKey: "plan-b",
    onProgress: null,
  });
  assert.equal(counter.calls, 4);
});

test("segment renderer validates input", async () => {
  const renderer = createSegmentRenderer({ encode: async () => ({ chunks: [] }) });
  assert.equal(
    await codeOf(renderer.renderSegments({}, { dims: [8, 8], segments: [], cache: null })),
    "bad_segment",
  );
  assert.equal(
    await codeOf(renderer.renderSegments({}, { segments: SEGMENTS, cache: null })),
    "bad_dims",
  );
});

test("mux writes video packets and returns mp4 bytes", async () => {
  const media = fakeMedia();
  const muxer = createMuxer({ media });
  const bytes = await muxer.mux({
    plan: { fps: 30, audio: { music_track_id: null, sfx: [] }, scenes: [] },
    segmentStats: {
      packets: [
        { data: new Uint8Array([1]), type: "key", timestamp: 0, duration: 1000 },
        { data: new Uint8Array([2]), type: "delta", timestamp: 1000, duration: 1000 },
      ],
    },
  });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(media.calls.video.length, 2);
  assert.equal(media.calls.video[0].wrapped.timestamp, 0);
  assert.equal(media.calls.finalized, 1);
  assert.deepEqual(media.calls.tracks, [["video", { frameRate: 30 }]]);

  assert.equal(
    await codeOf(muxer.mux({ plan: { fps: 30 }, segmentStats: { packets: [] } })),
    "empty_render",
  );
});

test("mux surfaces missing music track instead of muting", async () => {
  const media = fakeMedia();
  const muxer = createMuxer({
    media,
    proxyBase: "https://proxy.test",
    appToken: "tok",
    fetchImpl: async () => new Response(JSON.stringify({ items: [{ id: "other", url: "u" }] }), { status: 200 }),
  });
  assert.equal(
    await codeOf(
      muxer.mux({
        plan: { fps: 30, audio: { music_track_id: "m9", sfx: [] }, scenes: [{ duration_secs: 5 }] },
        segmentStats: { packets: [{ data: new Uint8Array([1]), type: "key", timestamp: 0, duration: 1 }] },
      }),
    ),
    "missing_track",
  );
});

test("createBrowserAdapters wires the full set", () => {
  const adapters = createBrowserAdapters({
    proxyBase: "https://proxy.test",
    appToken: "tok",
    cache: new MotionCache(new MemoryBackend()),
    loadElement: async () => ({ width: 1, height: 1 }),
  });
  assert.deepEqual(Object.keys(adapters).sort(), ["ai", "cache", "docs", "images", "mux", "renderer", "validate"]);
  assert.ok(adapters.docs instanceof Map);
  assert.equal(adapters.validate, null);
});
