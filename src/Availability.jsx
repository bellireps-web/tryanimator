import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { remainingMs, fmtCountdown, blinkOn } from "./availability.js";

/** Ticking clock (1s). Cleans up on unmount. */
function useNow(stepMs = 1000) {
  const [now, setNow] = createSignal(Date.now());
  let timer = 0;
  onMount(() => {
    timer = setInterval(() => setNow(Date.now()), stepMs);
  });
  onCleanup(() => clearInterval(timer));
  return now;
}

/**
 * Instant reappear: any click calls pokeCountdown() and every notice
 * stays visible for 7s from that instant (on top of the global blink).
 * Module-level on purpose: one shared beat for the whole app.
 */
const [wakeUntil, setWakeUntil] = createSignal(0);
export function pokeCountdown() {
  setWakeUntil(Date.now() + 7000);
}

/**
 * Always-on launch notice, e.g. "Available in 23:59:12.".
 * Ticks every second for everyone and blinks 7s on / 7s off in sync.
 */
export function CountdownNotice({ prefix = "Available in", cls = "" }) {
  const now = useNow();
  return (
    <Show when={blinkOn(now()) || now() < wakeUntil()}>
      <p class={cls} role="status">
        {remainingMs(now()) > 0 ? `${prefix} ${fmtCountdown(remainingMs(now()))}.` : "Available now."}
      </p>
    </Show>
  );
}
