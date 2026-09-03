import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { Sparkles } from "lucide-solid";
import { runMotionJob } from "./motion/jobs.js";
import "./studio.css";

const MOTION_PHASE = {
  queued: "En cola",
  resolving: "Resolviendo estilo y duración",
  authoring: "Authoring escenas",
  rendering: "Renderizando segmentos",
  done: "Listo",
  failed: "Error",
};

function MotionLoading({ motion, onDone, onBack }) {
  const { job: motionJob, adapters, onSnap } = motion;
  const [snap, setSnap] = createSignal({ state: "queued", progress: 0 });
  let alive = true;
  let finished = false;

  onMount(() => {
    runMotionJob(motionJob, adapters, (snapshot) => {
      if (!alive) return;
      setSnap(snapshot);
      if (onSnap) onSnap({ ...snapshot });
    }).then(() => {
      if (!alive || finished) return;
      finished = true;
      if (motionJob.state === "done") {
        setTimeout(() => { if (alive) onDone(motionJob); }, 400);
      }
    });
  });
  onCleanup(() => { alive = false; });

  const state = () => snap().state;
  const value = () => Math.round((snap().progress || 0) * 100);
  const error = () => motionJob.error;
  const [cw, ch] = [270, 480];

  return (
    <div class="ld-page">
      <div class="ld-card">
        <div class="ld-ratio">{motionJob.input.ratio}</div>
        <div class="ld-label">Motion · el agente está creando</div>
        <div class="ld-label dim">{motionJob.input.prompt}</div>
        <div class="ld-dream" style={{ width: `${cw}px`, height: `${ch}px` }} role="img" aria-label={`Generando motion: ${MOTION_PHASE[state()] ?? state()}, ${value()}%`}>
          <span class="blob b1" aria-hidden="true" />
          <span class="blob b2" aria-hidden="true" />
          <span class="blob b3" aria-hidden="true" />
          <span class="grain" aria-hidden="true" />
          <span class="vignette" aria-hidden="true" />
          <span class="ld-pill"><Sparkles />{MOTION_PHASE[state()] ?? state()}…</span>
          <span class="ld-big">{value()}%</span>
        </div>
        <div class="ld-bar" style={{ width: `${Math.min(cw, 420)}px` }} role="progressbar" aria-label="Progreso de generación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value()}>
          <div class="ld-track">
            <div class="ld-fill" style={{ transform: `scaleX(${(snap().progress || 0)})` }} />
          </div>
        </div>
        <Show when={state() === "failed"} fallback={<div class="ld-sub">{MOTION_PHASE[state()] ?? state()}</div>}>
          <div class="ld-sub">Error [{error() && error().code}]: {error() && error().message}</div>
          <button type="button" class="ld-tag" onClick={onBack}>Volver al editor</button>
        </Show>
      </div>
    </div>
  );
}

const TOTAL_MS = 12000;
// Element -> fase del pipeline. El resto queda en cola del agente (visible, sin aplicar).
const STAGE_OF = { "Remove Silences": "silence", Captions: "captions", "B Rolls": "brolls" };
const CARD_BOX = { "16:9": [640, 360], "9:16": [270, 480], "1:1": [400, 400], "4:3": [480, 360] };

export default function LoadingView({ job, onDone, motion, onBack }) {
  if (motion) return <MotionLoading motion={motion} onDone={onDone} onBack={onBack} />;
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

  const phase = () => {
    const v = value() / 100;
    const p = plan();
    const nSil = p ? p.cuts.filter((c) => c.type === "silence").length : null;
    const nCap = p?.captions.length ?? null;
    const nBr = p?.brolls.length ?? null;
    if (v < PHASES[0][0]) return PHASES[0][1];
    if (v < PHASES[1][0]) return nSil === null ? "Cortando silencios" : `Cortando ${nSil} silencio${nSil === 1 ? "" : "s"}`;
    if (v < PHASES[2][0]) return nCap === null ? "Escribiendo captions" : `Escribiendo ${nCap} captions`;
    if (v < PHASES[3][0]) return nBr === null ? "Colocando b-rolls" : `Colocando ${nBr} b-rolls`;
    return PHASES[4][1];
  };

  const [cw, ch] = CARD_BOX[ratio] ?? CARD_BOX["16:9"];

  return (
    <div class="ld-page">
      <div class="ld-card">
        <div class="ld-ratio">{ratio}</div>
        <div class="ld-label">Ratio del video · el agente está creando</div>
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
        <Show when={plan()?.timelineDuration}>
          <div class="ld-sub dim">timeline estimada: {plan().timelineDuration.toFixed(1)} s</div>
        </Show>
      </div>
    </div>
  );
}
