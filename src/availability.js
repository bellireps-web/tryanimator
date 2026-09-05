/**
 * Global launch countdown: one fixed deadline for every user.
 * It ticks on its own (never starts on click) and the 7s blink cycle is
 * derived from the epoch, so all clients stay in sync.
 */

// Fixed launch moment (UTC). Same instant for everyone, worldwide.
export const AVAILABLE_AT = Date.parse("2026-09-06T23:25:55.000Z");

/** Milliseconds left until launch (never negative). Pure. */
export function remainingMs(now = Date.now()) {
  return Math.max(0, AVAILABLE_AT - now);
}

/** "23:59:12" style clock. Pure. */
export function fmtCountdown(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

/**
 * Blink gate: visible during the first 7s of every 14s cycle.
 * Epoch-based, so every user sees the same on/off beat. Pure.
 */
export function blinkOn(now = Date.now()) {
  return Math.floor(now / 1000) % 14 < 7;
}
