/**
 * Cache keys mirroring motion-core/src/cache.rs EXACTLY.
 * FNV-1a 64 needs BigInt: JS numbers lose 64-bit precision.
 * Cross-language vectors are pinned in keys.test.js (must match Rust).
 */

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

const encoder = new TextEncoder();

export function fnv1a64(bytes) {
  let hash = OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash;
}

export function hex16(value) {
  return value.toString(16).padStart(16, "0");
}

export function hashString(text) {
  return hex16(fnv1a64(encoder.encode(text)));
}

function scoped(scope, composite) {
  return `motion/v1/${scope}/${hashString(composite)}`;
}

export function planKey(canonicalPlanJson) {
  return scoped("plan", canonicalPlanJson);
}

export function docKey(planKeyValue, docId, modelVersion) {
  return scoped("doc", `${planKeyValue}\n${docId}\n${modelVersion}`);
}

export function segmentKey(planKeyValue, index, startFrame, frameCount) {
  return scoped("seg", `${planKeyValue}\n${index}\n${startFrame}\n${frameCount}`);
}

export function finalKey(planKeyValue, modelVersion) {
  return scoped("final", `${planKeyValue}\n${modelVersion}`);
}
