import test from "node:test";
import assert from "node:assert/strict";
import { fnv1a64, hex16, hashString, planKey, docKey, segmentKey, finalKey } from "./keys.js";

const encoder = new TextEncoder();

test("fnv vectors (must match motion-core/src/cache.rs)", () => {
  assert.equal(fnv1a64(encoder.encode("")), 14695981039346656037n);
  assert.equal(hex16(fnv1a64(encoder.encode(""))), "cbf29ce484222325");
  assert.equal(hashString("foobar"), "85944171f73967e8");
});

test("keys are stable, scoped and versioned", () => {
  const a = planKey("{}");
  assert.equal(a, planKey("{}"));
  assert.match(a, /^motion\/v1\/plan\/[0-9a-f]{16}$/);
  assert.notEqual(a, planKey('{"a":1}'));
  assert.notEqual(docKey(a, "d1", "m1"), segmentKey(a, 0, 0, 600));
  assert.notEqual(docKey(a, "d1", "m1"), docKey(a, "d1", "m2"));
  assert.notEqual(finalKey(a, "m1"), finalKey(a, "m2"));
  assert.notEqual(segmentKey(a, 0, 0, 600), segmentKey(a, 1, 600, 600));
});
