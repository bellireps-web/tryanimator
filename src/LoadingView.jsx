import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { Sparkles } from "lucide-solid";
import "./studio.css";

const TOTAL_MS = 12000;
// Element -> fase del pipeline. El resto queda en cola del agente (visible, sin aplicar).
const STAGE_OF = { "Remove Silences": "silence", Captions: "captions", "B Rolls": "brolls" };
const CARD_BOX = { "16:9": [640, 360], "9:16": [270, 480], "1:1": [400, 400], "4:3": [480, 360] };

export default function LoadingView({ job, onDone }) {
  // Mock theater for the non-motion editor path (no backend generates here).
  // Motion jobs skip this screen entirely: the Studio runs them in-situ.
  const ratio = job.ratio ?? "9:16";
  const selected = job.elements?.length
    ? job.elements
    : Object.keys(STAGE_OF);
  const queued = selected.filter((e) => !(e in STAGE_OF));
  const [value, setValue] = createSignal(0);
  const [left, setLeft] = createSignal(TOTAL_MS / 1000);
  const [plan, setPlan] = createSignal(null);
  let raf = 0;
  let done = false;
  let alive = true;
  let t0 = 0;

  onMount(() => {
    fetch("plan.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && alive) setPlan(p); })
      .catch(() => {});
    raf = requestAnimationFrame(tick);
  });
  onCleanup(() => { alive = false; cancelAnimationFrame(raf); });

  const finish = () => { if (!done) { done = true; setTimeout(() => { if (alive) onDone(); }, 400); } };
  const tick = (t) => {
    if (!t0) t0 = t;
    const el = t - t0;
    setValue(Math.min(100, (el / TOTAL_MS) * 100));
    setLeft(Math.max(0, (TOTAL_MS - el) / 1000));
    if (el >= TOTAL_MS) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };

  const steps = () => {
    const p = plan();
    const n = (k, all, word) => {
      if (!all) return word;
      const c = k === "silence" ? all.cuts.filter((x) => x.type === "silence").length
        : k === "captions" ? all.captions.length : all.brolls.length;
      return `${word} (${c})`;
    };
    const mid = selected.filter((e) => e in STAGE_OF).map((e) => n(STAGE_OF[e], p,
      e === "Remove Silences" ? "Cortando silencios" : e === "Captions" ? "Escribiendo captions" : "Colocando b-rolls"));
    return ["Analizando prompt", ...mid, "Montando timeline"];
  };
  const phase = () => {
    const s = steps();
    return s[Math.min(s.length - 1, Math.floor((value() / 100) * s.length))];
  };

  const [cw, ch] = CARD_BOX[ratio] ?? CARD_BOX["16:9"];
  const vids = job.videos ?? [];

  return (
    <div class="ld-page">
      <div class="ld-card">
        <div class="ld-ratio">{ratio}</div>
        <div class="ld-label">Ratio del video · el agente está creando</div>
        <Show when={vids.length}>
          <div class="ld-label">Video: {vids[0].name ?? "sin nombre"}{vids.length > 1 ? ` (+${vids.length - 1})` : ""}</div>
        </Show>
        <div class="ld-dream" style={{ width: `${cw}px`, height: `${ch}px` }} role="img" aria-label={`Generando video ${ratio}: ${phase()}, ${Math.floor(value())}%`}>
          <span class="blob b1" aria-hidden="true" />
          <span class="blob b2" aria-hidden="true" />
          <span class="blob b3" aria-hidden="true" />
          <span class="grain" aria-hidden="true" />
          <span class="vignette" aria-hidden="true" />
          <span class="ld-pill"><Sparkles />{phase()}…</span>
          <span class="ld-big">{Math.floor(value())}%</span>
        </div>
        <div class="ld-bar" style={{ width: `${Math.min(cw, 420)}px` }} role="progressbar" aria-label="Progreso de generación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(value())}>
          <div class="ld-track">
            <div class="ld-fill" style={{ transform: `scaleX(${value() / 100})` }} />
          </div>
        </div>
        <div class="ld-sub">quedan ~{Math.ceil(left())} s · {phase()}</div>
        <div class="ld-tags" aria-label="Elements seleccionados">
          <For each={selected}>{(e) => <span class={`ld-tag ${e in STAGE_OF ? "" : "queued"}`}>{e}</span>}</For>
        </div>
        <Show when={queued.length}>
          <div class="ld-sub dim">en cola del agente: {queued.join(", ")}</div>
        </Show>
      </div>
    </div>
  );
}
