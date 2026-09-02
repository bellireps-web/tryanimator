import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { Play, Pause, Plus } from "lucide-solid";
import { RATIOS } from "./NewVideoView.jsx";
import "./studio.css";

const PREVIEW_H = 479;
const ratioWidth = (ratio) => {
  const [w, h] = ratio.split(":").map(Number);
  return Math.min(811, Math.round((PREVIEW_H * w) / h));
};
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

function BackArrow() {
  return <svg viewBox="0 0 30 18" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M30 9H2" /><path d="M9 1 1 9l8 8" /></svg>;
}
function SendIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>;
}

export default function StudioEditorView({ job, onNewVideo, onExport }) {
  const [plan, setPlan] = createSignal(null);
  const [ratio, setRatio] = createSignal(job.ratio);
  const [draft, setDraft] = createSignal("");
  const [msgs, setMsgs] = createSignal(job.prompt ? [{ kind: "user", text: job.prompt }] : []);
  const [playing, setPlaying] = createSignal(false);
  const [t, setT] = createSignal(0);
  let raf = 0;
  let last = 0;

  const duration = () => plan()?.timelineDuration ?? 0;

  onMount(() => {
    fetch("plan.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setPlan)
      .catch(() => setPlan({ timelineDuration: 0, captions: [], brolls: [], error: true }));
  });

  const loop = (now) => {
    if (!last) last = now;
    const dt = (now - last) / 1000;
    last = now;
    setT((cur) => {
      const next = cur + dt;
      if (next >= duration() || duration() === 0) { setPlaying(false); return duration(); }
      return next;
    });
    if (playing()) raf = requestAnimationFrame(loop);
  };
  const togglePlay = () => {
    if (duration() === 0) return;
    if (t() >= duration()) setT(0);
    last = 0;
    setPlaying((p) => {
      if (!p) raf = requestAnimationFrame(loop);
      return !p;
    });
  };
  onCleanup(() => cancelAnimationFrame(raf));

  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setT(frac * duration());
  };
  const send = () => {
    const text = draft().trim();
    if (!text) return;
    setMsgs((m) => [...m, { kind: "user", text }]);
    setDraft("");
  };
  const addContext = () => {
    const p = plan();
    if (!p || p.error) return;
    setMsgs((m) => [...m, { kind: "ctx", text: `Contexto: ${p.captions.length} captions, ${p.brolls.length} b-rolls, ${p.timelineDuration.toFixed(1)}s en ${ratio()}` }]);
  };
  const cycleRatio = () => setRatio((r) => RATIOS[(RATIOS.indexOf(r) + 1) % RATIOS.length]);
  const activeCaption = () => plan()?.captions?.find((c) => t() >= c.t0 && t() < c.t1)?.text ?? "";
  const captureFrame = () => {
    const p = plan();
    const img = document.querySelector(".st-preview img");
    if (!p || p.error || !img || !img.complete || img.naturalWidth === 0) return;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = ratioWidth(ratio()) * scale;
    canvas.height = PREVIEW_H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = canvas.width / canvas.height;
    let dw, dh;
    if (ir > cr) { dh = canvas.height; dw = dh * ir; } else { dw = canvas.width; dh = dw / ir; }
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    const cap = activeCaption();
    if (cap) {
      ctx.font = `600 ${28 * scale}px Figtree, sans-serif`;
      ctx.textAlign = "center";
      const pad = 16 * scale;
      const tw = Math.min(canvas.width - 80 * scale, ctx.measureText(cap).width + pad * 2);
      const bx = (canvas.width - tw) / 2;
      const by = canvas.height - 170 * scale;
      ctx.fillStyle = "rgba(6,5,17,.78)";
      ctx.beginPath();
      ctx.roundRect(bx, by, tw, 52 * scale, 14 * scale);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(cap, canvas.width / 2, by + 36 * scale, tw - pad);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `frame-${fmt(t()).replace(":", "m")}s.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  return (
    <div class="st-page">
      <aside class="st-left" aria-label="Chat del editor">
        <div class="st-top">
          <button class="st-back" onClick={onNewVideo} aria-label="Nuevo video"><BackArrow /><span>New Video</span></button>
          <button class="st-plus">Upgrade to Plus</button>
        </div>
        <div class="st-spacer" />
        <div class="st-chat">
          <div class="st-msgs" aria-live="polite">
            <For each={msgs()}>{(m) => <div class={`st-msg ${m.kind}`}>{m.text}</div>}</For>
          </div>
          <textarea
            class="st-input"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Describe the changes you want in the video"
            aria-label="Describe the changes you want in the video"
          />
          <div class="st-tools">
            <button class="st-tool" onClick={addContext} aria-label="Añadir contexto del plan">+</button>
            <button class="st-tool" onClick={cycleRatio} aria-label={`Ratio actual ${ratio()}. Cambiar`} title={ratio()}>
              <span class="rect" style={{ display: "block", width: ratio() === "9:16" ? "10px" : ratio() === "16:9" ? "20px" : ratio() === "1:1" ? "15px" : "18px", height: ratio() === "9:16" ? "18px" : ratio() === "16:9" ? "12px" : ratio() === "1:1" ? "15px" : "13px", border: "1.5px solid #fff", "border-radius": "3px" }} />
            </button>
            <button class="st-send" disabled={!draft().trim()} onClick={send} aria-label="Enviar"><SendIcon /></button>
          </div>
        </div>
        <p class="st-beta">This is a early beta can be errors</p>
      </aside>

      <main class="st-main" aria-label="Vista previa">
        <div class="st-main-top">
          <button class="st-export" onClick={onExport}>Export</button>
        </div>
        <button class="st-capture" onClick={captureFrame} aria-label="Capturar frame actual"><Plus /><span>Capturar Frame</span></button>
        <div class="st-preview" style={{ width: `${ratioWidth(ratio())}px`, height: `${PREVIEW_H}px` }}>
          <Show when={plan()?.brolls?.length} fallback={<span class="st-empty">{ratio()} · {fmt(duration())}</span>}>
            <img src="poster.png" alt={`Fotograma en ${fmt(t())}`} />
          </Show>
        </div>
        <div class="st-transport">
          <button class="st-play" onClick={togglePlay} aria-label={playing() ? "Pausar" : "Reproducir"}>
            {playing() ? <Pause /> : <Play />}
          </button>
          <div class="st-track" onClick={seek} role="slider" aria-label="Posición" aria-valuemin={0} aria-valuemax={Math.round(duration())} aria-valuenow={Math.round(t())}>
            <div class="st-fill" style={{ transform: `scaleX(${duration() ? t() / duration() : 0})` }} />
          </div>
          <span class="st-time">{fmt(t())} / {fmt(duration())}</span>
        </div>
      </main>
    </div>
  );
}
