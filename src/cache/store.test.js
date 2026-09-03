import test from "node:test";
import assert from "node:assert/strict";
import { MemoryBackend, MotionCache } from "./store.js";

function cache(quotaBytes = 100) {
  return new MotionCache(new MemoryBackend(), { quotaBytes });
}

test("put/get round trip and miss", async () => {
  const motionCache = cache();
  assert.equal(await motionCache.get("k"), null);
  await motionCache.put("k", "blob", 10);
  assert.equal(await motionCache.get("k"), "blob");
});

test("lru evicts oldest until fit", async () => {
  const backend = new MemoryBackend();
  const motionCache = new MotionCache(backend, { quotaBytes: 100 });
  await backend.put({ key: "a", blob: "a", bytes: 40, at: 1000 });
  await backend.put({ key: "b", blob: "b", bytes: 40, at: 2000 });
  // Touch a so b is least-recently-used regardless of clock granularity.
  assert.equal(await motionCache.get("a"), "a");
  await motionCache.put("c", "c", 40);
  assert.equal(await motionCache.get("b"), null);
  assert.equal(await motionCache.get("a"), "a");
  assert.equal(await motionCache.get("c"), "c");
});

test("overwrite replaces size accounting", async () => {
  const motionCache = cache(100);
  await motionCache.put("a", "a", 90);
  await motionCache.put("a", "a2", 10);
  await motionCache.put("b", "b", 90);
  assert.equal(await motionCache.get("a"), "a2");
  assert.equal(await motionCache.get("b"), "b");
});

test("oversize blob still stores after clearing", async () => {
  const motionCache = cache(10);
  await motionCache.put("small", "s", 5);
  await motionCache.put("big", "b", 50);
  assert.equal(await motionCache.get("big"), "b");
  assert.equal(await motionCache.get("small"), null);
});

test("invalidate drops the entry", async () => {
  const motionCache = cache();
  await motionCache.put("k", "v", 10);
  await motionCache.invalidate("k");
  assert.equal(await motionCache.get("k"), null);
});

test("rejects negative sizes", async () => {
  const motionCache = cache();
  await assert.rejects(() => motionCache.put("k", "v", -1));
});
