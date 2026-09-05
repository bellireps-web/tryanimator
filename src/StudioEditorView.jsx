import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { Play, Pause, Plus, Volume2, VolumeX, Maximize, Minimize, Sparkles } from "lucide-solid";
import { RATIOS } from "./NewVideoView.jsx";
import { stableJson, applyPatchOps, applyRevisionToChangedScenes, authoredEmptyIndexes, createMotionJob, recordTurnStep, runMotionJob } from "./motion/jobs.js";
import { threadHistoryForAgent, filterUnaskedDurationOps } from "./motion/auto.js";
import { getMotionProjects, mergeChatTurn, persistCompTurn } from "./motion/projects.js";
import "./studio.css";

const PREVIEW_H = 479;
const PATCH_PHASE = {
  queued: "En cola",
  resolving: "Consultando al agente",
  authoring: "Re-dibujando escenas",
  rendering: "Renderizando",
  done: "Listo",
  failed: "Error",
};
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

/** " · gate: reintento escena 0 [motivos] → ok" or "" when clean. */
function fmtGate(job) {
  const reports = (job && job.gateReports) || [];
  const retried = reports.filter((r) => r.attempts > 1);
  if (!retried.length) return "";
  const parts = retried.map((r) => {
    const why = (r.problems || []).join("; ").slice(0, 100);
    const after = r.retryProblems && r.retryProblems.length
      ? ` → sigue: ${r.retryProblems.join("; ").slice(0, 100)}`
      : " → ok";
    return `escena ${r.scene} [${why}]${after}`;
  });
  return ` · gate: reintento ${parts.join(", ")}`;
}

/** "12.4k tokens (11.9k razonando) · 62% caché" or null when nothing was metered. */
export function fmtTokens(usage) {
  if (!usage) return null;
  const prompt = usage.prompt_tokens || 0;
  const total = prompt + (usage.completion_tokens || 0);
  if (!total) return null;
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const reasoning = usage.reasoning_tokens || 0;
  const cached = usage.cached_tokens || 0;
  const hit = prompt > 0 && cached > 0 ? ` · ${Math.round((cached / prompt) * 100)}% caché` : "";
  return (reasoning ? `${k(total)} tokens (${k(reasoning)} razonando)` : `${k(total)} tokens`) + hit;
}

export default function StudioEditorView({ job, onNewVideo, onExport, onJobDone, motionJob, motionSnap, adapters, onMotionSnap }) {
  const [plan, setPlan] = createSignal(null);
  const [ratio, setRatio] = createSignal(job.ratio);
  const [draft, setDraft] = createSignal("");
  const [msgs, setMsgs] = createSignal(
    Array.isArray(job.chat) && job.chat.length
      ? job.chat.map((m) => ({ kind: m.kind, text: m.text, ...(m.thinking ? { thinking: m.thinking } : {}), ...(m.trace ? { trace: m.trace } : {}), ...(Array.isArray(m.steps) ? { steps: m.steps } : {}), ...(Array.isArray(m.ops) ? { ops: m.ops } : {}) }))
      : job.prompt ? [{ kind: "user", text: job.prompt }] : [],
  );
  // Motion follow-up state: the finished job, its mp4 object URL, patch flow.
  const [mJob, setMJob] = createSignal(motionJob || null);
  const [videoUrl, setVideoUrl] = createSignal(null);
  const [patching, setPatching] = createSignal(false);
  // Composition identity: v1 on arrival, +1 per applied patch. Same plan
  // object evolves across turns; only rebuilt scenes are re-authored.
  const [compVersion, setCompVersion] = createSignal(Number.isFinite(job.compVersion) && job.compVersion > 0 ? Math.floor(job.compVersion) : 1);
  const motionPlan = () => mJob()?.result?.plan || null;
  const motionSecs = () => motionPlan()?.duration || 0;
  createEffect(() => {
    const video = mJob()?.result?.video;
    if (video && video.length) {
      const url = URL.createObjectURL(new Blob([video], { type: "video/mp4" }));
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    }
  });
  onCleanup(() => { const url = videoUrl(); if (url) URL.revokeObjectURL(url); });
  // Inline generation (no loading screen): unfinished motion jobs run here,
  // painting the purple gradient + % into the preview until the MP4 lands.
  const [genError, setGenError] = createSignal(null);
  let genAlive = true;
  onCleanup(() => { genAlive = false; });
  const jobRunning = () => {
    const j = mJob();
    return !!(j && j.state !== "done" && j.state !== "failed" && !videoUrl() && !genError());
  };
  const jobFailed = () => {
    const j = mJob();
    return !!((j && j.state === "failed") || genError());
  };
  const genPct = () => Math.round(((motionSnap && motionSnap.progress) || 0) * 100);
  const genPhase = () => PATCH_PHASE[(motionSnap && motionSnap.state) || (mJob() && mJob().state)] ?? "Creando";
  const genFailMessage = () => {
    const err = genError() || (mJob() && mJob().error);
    return err ? `Error [${err.code || "failed"}]: ${err.message || err}` : "Error generando el video";
  };
  const [playing, setPlaying] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [isFull, setIsFull] = createSignal(false);
  const [t, setT] = createSignal(0);
  const [vidDur, setVidDur] = createSignal(0);
  let raf = 0;
  let last = 0;
  let vid = null;
  let threadEl = null;
  createEffect(() => {
    msgs();
    patching();
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  });
  let previewBox = null;
  const attachVideo = (el) => {
    vid = el;
    if (el) el.muted = muted();
  };
  const toggleMute = () => {
    if (vid) {
      vid.muted = !vid.muted;
      setMuted(vid.muted);
    } else {
      setMuted(!muted());
    }
  };
  const toggleFull = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (previewBox && previewBox.requestFullscreen) previewBox.requestFullscreen().catch(() => {});
    } catch {
      // Fullscreen unavailable: the custom transport keeps working.
    }
  };

  const srcVideo = () => (job.videos ?? [])[0] ?? null;
  const duration = () => vidDur() || plan()?.timelineDuration || motionSecs() || 0;

  onMount(() => {
    fetch("plan.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setPlan)
      .catch(() => setPlan({ timelineDuration: 0, captions: [], brolls: [], error: true }));
    const onFullChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullChange);
    onCleanup(() => document.removeEventListener("fullscreenchange", onFullChange));
    const arrived = mJob();
    if (arrived && arrived.state === "done" && arrived.result && arrived.result.plan) {
      // Fresh jobs arrive with just the user prompt; reopened comps already
      // carry their history, so only announce the former.
      const inherited = Array.isArray(job.chat) ? job.chat.length : 0;
      if (inherited <= 1) {
        const p = arrived.result.plan;
        const thought = fmtTokens(arrived.result.usage);
        setMsgs((m) => [...m, {
          kind: "ai",
          text: `Composición v1 lista · ${p.scenes.length} ${p.scenes.length === 1 ? "escena" : "escenas"} · ${p.duration}s`,
          thinking: arrived.result.thinking || undefined,
          trace: thought ? `pensó ${thought}` : undefined,
        }]);
      }
    }
    // Inline generation (no loading screen): unfinished jobs run here.
    const pending = mJob();
    if (pending && pending.state !== "done" && pending.state !== "failed" && adapters) {
      const genSteps = [];
      runMotionJob(pending, adapters, (snapshot) => {
        if (!genAlive) return;
        recordTurnStep(genSteps, snapshot);
        if (onMotionSnap) onMotionSnap({ ...snapshot });
      }).then(async () => {
        if (!genAlive) return;
        if (pending.state === "done") {
          // Publish immediately so the preview appears even if saving fails
          // (same as the old behavior), then save, then re-publish: onJobDone
          // assigns compId/chat onto pending, and the second copy carries
          // them so later patches persist. The videoUrl effect revokes the
          // interim object URL.
          setMJob({ ...pending });
          const p = pending.result.plan;
          const thought = fmtTokens(pending.result.usage);
          const gateBits = fmtGate(pending).replace(/^ · /, "");
          setMsgs((m) => [...m, {
            kind: "ai",
            text: `Composición v1 lista · ${p.scenes.length} ${p.scenes.length === 1 ? "escena" : "escenas"} · ${p.duration}s`,
            thinking: pending.result.thinking || undefined,
            trace: [thought ? `pensó ${thought}` : "", gateBits].filter(Boolean).join(" · ") || undefined,
            steps: genSteps.length ? [...genSteps] : undefined,
          }]);
          if (onJobDone) await onJobDone(pending);
          setMJob({ ...pending });
        } else if (pending.state === "failed") {
          setGenError(pending.error);
          if (onMotionSnap) onMotionSnap(null);
        }
      });
    }
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
    if (vid) {
      if (t() >= duration()) vid.currentTime = 0;
      if (vid.paused) vid.play().catch(() => setPlaying(false));
      else vid.pause();
      return;
    }
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
    if (vid) vid.currentTime = frac * duration();
    else setT(frac * duration());
  };
  const sendMotionPatch = async (text) => {
    const current = mJob();
    const planSnapshot = current?.result?.plan;
    if (!planSnapshot || !adapters) return;
    setPatching(true);
    if (onMotionSnap) onMotionSnap(null); // Drop the previous job's snapshot so the phase line tracks this patch.
    // Persist the user turn immediately (union, never overwrite): if the
    // view unmounts mid-patch — or another turn lands concurrently — the
    // turn survives even though its answer may be lost.
    try {
      const compId0 = current.compId || mJob()?.compId;
      if (compId0) {
        const projects = getMotionProjects();
        const rec = await projects.get(compId0).catch(() => null);
        if (rec) await projects.update(compId0, { chat: mergeChatTurn(rec.chat, msgs()) });
      }
    } catch (error) {
      console.warn("projects: user turn persist failed", error);
    }
    try {
      const history = threadHistoryForAgent(msgs(), text);
      const patch = await adapters.ai.chatPatch(stableJson(planSnapshot), text, history);
      const { ops: rawOps, message: words, thinking } = patch;
      const ops = filterUnaskedDurationOps(rawOps, text);
      const getDoc = adapters.docs && typeof adapters.docs.get === "function" ? (id) => adapters.docs.get(id) : undefined;
      const next = applyRevisionToChangedScenes(planSnapshot, applyPatchOps(planSnapshot, ops), text, getDoc);
      const rebuilt = authoredEmptyIndexes(next);
      const retry = createMotionJob({ ...current.input, seed: next.seed });
      retry.basePlan = next;
      const turnSteps = [];
      await runMotionJob(retry, adapters, (snapshot) => {
        recordTurnStep(turnSteps, snapshot);
        if (onMotionSnap) onMotionSnap({ ...snapshot });
      });
      if (retry.state === "done") {
        const version = compVersion() + 1;
        setCompVersion(version);
        setMJob(retry);
        const thought = fmtTokens(retry.result.usage);
        const trace =
          `Composición v${version} · ${next.scenes.length} ${next.scenes.length === 1 ? "escena" : "escenas"} · ${next.duration}s` +
          (rebuilt.length ? ` · re-hechas [${rebuilt.join(", ")}]` : "") +
          (thought ? ` · ${thought}` : "") +
          fmtGate(retry);
        const newMsgs = [...msgs(), { kind: "ai", text: words || "Cambios aplicados.", thinking: thinking || undefined, trace, steps: turnSteps.length ? [...turnSteps] : undefined, ops: ops && ops.length ? ops : undefined }];
        setMsgs(newMsgs);
        // Persist over the same comp with union semantics: concurrent turns
        // (two mounts, reload in between) merge chats instead of clobbering.
        try {
          const compId = current.compId || mJob()?.compId;
          if (compId) {
            const saved = await persistCompTurn(getMotionProjects(), compId, {
              version,
              plan: retry.result.plan,
              video: retry.result.video,
              usage: retry.result.usage,
              chat: newMsgs,
            });
            retry.compId = compId;
            retry.compVersion = saved.version;
            retry.chat = newMsgs;
          }
        } catch (error) {
          console.warn("projects: patch persist failed", error);
        }
      } else {
        if (onMotionSnap) onMotionSnap(null); // Drop the stale phase chip on failure.
        setMsgs((m) => [...m, { kind: "ai", text: `Error [${retry.error.code}]: ${retry.error.message}` }]);
      }
    } catch (error) {
      setMsgs((m) => [...m, { kind: "ai", text: `Error [${(error && error.code) || "failed"}]: ${(error && error.message) || error}` }]);
    } finally {
      setPatching(false);
    }
  };
  const send = () => {
    const text = draft().trim();
    if (!text || patching()) return;
    // Chat IA pausado: al dar Enter no se envía nada al agente.
    setMsgs((m) => [...m, { kind: "user", text }, { kind: "ai", text: "Disponible en 24 horas." }]);
    setDraft("");
  };
  const addContext = () => {
    const mp = motionPlan();
    if (mp) {
      setMsgs((m) => [...m, { kind: "ctx", text: `Motion: ${mp.scenes.length} escenas, ${mp.duration}s, lienzo libre en ${ratio()}` }]);
      return;
    }
    const p = plan();
    if (!p || p.error) return;
    setMsgs((m) => [...m, { kind: "ctx", text: `Contexto: ${p.captions.length} captions, ${p.brolls.length} b-rolls, ${p.timelineDuration.toFixed(1)}s en ${ratio()}` }]);
  };
  const downloadMotion = () => {
    const video = mJob()?.result?.video;
    if (!video || !video.length) return;
    const url = videoUrl() || URL.createObjectURL(new Blob([video], { type: "video/mp4" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `animator-${Math.round(motionSecs())}s.mp4`;
    a.click();
    if (!videoUrl()) setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const cycleRatio = () => setRatio((r) => RATIOS[(RATIOS.indexOf(r) + 1) % RATIOS.length]);
  const activeCaption = () => plan()?.captions?.find((c) => t() >= c.t0 && t() < c.t1)?.text ?? "";
  const captureFrame = () => {
    const p = plan();
    const media = document.querySelector(".st-preview video") || document.querySelector(".st-preview img");
    if (!p || p.error || !media) return;
    const iw = media.videoWidth || media.naturalWidth;
    const ih = media.videoHeight || media.naturalHeight;
    if (!iw || (media.tagName === "IMG" && !media.complete)) return;
    if (media.tagName === "VIDEO" && media.readyState < 2) return;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = ratioWidth(ratio()) * scale;
    canvas.height = PREVIEW_H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ir = iw / ih;
    const cr = canvas.width / canvas.height;
    let dw, dh;
    if (ir > cr) { dh = canvas.height; dw = dh * ir; } else { dw = canvas.width; dh = dw / ir; }
    ctx.drawImage(media, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
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
        <div class="st-thread" ref={(el) => { threadEl = el; }} aria-live="polite">
          <For each={msgs()}>{(m) => (
            <div class={`st-msg ${m.kind}`}>
              <Show when={m.kind === "ai" && m.thinking}>
                <details class="st-thinking">
                  <summary>Pensamiento</summary>
                  <div class="st-thinking-body">{m.thinking}</div>
                </details>
              </Show>
              <Show when={m.text}><div class="st-words">{m.text}</div></Show>
              <Show when={m.kind === "ai" && m.steps && m.steps.length}>
                <details class="st-steps">
                  <summary>Actividad · {m.steps.length} {m.steps.length === 1 ? "paso" : "pasos"}</summary>
                  <div class="st-steps-body">
                    <For each={m.steps}>{(s, i) => (
                      <div class="st-step">
                        <span class="st-step-state">{PATCH_PHASE[s.state] ?? s.state}</span>
                        <span class="st-step-pct">{s.progress}%</span>
                        <Show when={i() > 0 && m.steps[0].at}>
                          <span class="st-step-at">+{((s.at - m.steps[0].at) / 1000).toFixed(1)}s</span>
                        </Show>
                      </div>
                    )}</For>
                    <Show when={m.ops && m.ops.length}>
                      <pre class="st-ops">{JSON.stringify(m.ops, null, 2)}</pre>
                    </Show>
                  </div>
                </details>
              </Show>
              <Show when={m.kind === "ai" && m.trace}><div class="st-trace">{m.trace}</div></Show>
            </div>
          )}</For>
          <Show when={patching()}>
            <div class="st-msg ai" aria-live="polite">
              {motionSnap ? `${PATCH_PHASE[motionSnap.state] ?? motionSnap.state}… ${Math.round((motionSnap.progress || 0) * 100)}%` : "Consultando al agente…"}
            </div>
          </Show>
        </div>
        <div class="st-chat">
          <textarea
            class="st-input"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={mJob() ? (patching() ? "Aplicando cambios…" : "Describe los cambios del motion") : "Describe the changes you want in the video"}
            aria-label="Describe the changes you want in the video"
          />
          <div class="st-tools">
            <button class="st-tool" onClick={addContext} aria-label="Añadir contexto del plan">+</button>
            <button class="st-tool" onClick={cycleRatio} aria-label={`Ratio actual ${ratio()}. Cambiar`} title={ratio()}>
              <span class="rect" style={{ display: "block", width: ratio() === "9:16" ? "10px" : ratio() === "16:9" ? "20px" : ratio() === "1:1" ? "15px" : "18px", height: ratio() === "9:16" ? "18px" : ratio() === "16:9" ? "12px" : ratio() === "1:1" ? "15px" : "13px", border: "1.5px solid #fff", "border-radius": "3px" }} />
            </button>
            <button class="st-send" disabled={!draft().trim() || patching()} onClick={send} aria-label="Enviar"><SendIcon /></button>
          </div>
        </div>
        <p class="st-beta">This is a early beta can be errors</p>
      </aside>

      <main class="st-main" aria-label="Vista previa">
        <div class="st-main-top">
          <button class="st-export" onClick={() => { if (videoUrl()) downloadMotion(); else onExport(); }}>{videoUrl() ? "Descargar MP4" : "Export"}</button>
        </div>
        <button class="st-capture" onClick={captureFrame} aria-label="Capturar frame actual"><Plus /><span>Capturar Frame</span></button>
        <div class="st-stage" ref={(el) => { previewBox = el; }}>
        <div class="st-preview" style={{ width: `${ratioWidth(ratio())}px`, height: `${PREVIEW_H}px` }}>
          <Show when={videoUrl()} fallback={
          <Show when={jobRunning()} fallback={
          <Show when={jobFailed()} fallback={
          <Show when={srcVideo()} fallback={
            <Show when={plan()?.brolls?.length} fallback={<span class="st-empty">{ratio()} · {fmt(duration())}</span>}>
              <img src="poster.png" alt={`Fotograma en ${fmt(t())}`} />
            </Show>
          }>
            {(v) => (
              <video
                ref={attachVideo}
                src={v().url}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => setVidDur(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            )}
          </Show>
          }>
            <div class="st-loading-error" role="alert">
              <span>{genFailMessage()}</span>
              <button type="button" onClick={onNewVideo}>Volver</button>
            </div>
          </Show>
          }>
            <div class="ld-dream" role="img" aria-label={`Generando video: ${genPhase()}, ${genPct()}%`}>
              <span class="blob b1" aria-hidden="true" />
              <span class="blob b2" aria-hidden="true" />
              <span class="blob b3" aria-hidden="true" />
              <span class="grain" aria-hidden="true" />
              <span class="vignette" aria-hidden="true" />
              <span class="ld-pill"><Sparkles />{genPhase()}…</span>
            </div>
          </Show>
          }>
            <video
              ref={attachVideo}
              src={videoUrl()}
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => setVidDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          </Show>
        </div>
        <Show when={jobRunning()}>
          <div class="st-loading-status" aria-live="polite"><b>{genPct()}%</b><span>{genPhase()}</span></div>
        </Show>
        <div class="st-transport">
          <button class="st-play" onClick={togglePlay} aria-label={playing() ? "Pausar" : "Reproducir"}>
            {playing() ? <Pause /> : <Play />}
          </button>
          <div class="st-track" onClick={seek} role="slider" aria-label="Posición" aria-valuemin={0} aria-valuemax={Math.round(duration())} aria-valuenow={Math.round(t())}>
            <div class="st-fill" style={{ transform: `scaleX(${duration() ? t() / duration() : 0})` }} />
          </div>
          <span class="st-time">{fmt(t())} / {fmt(duration())}</span>
          <button class="st-play" onClick={toggleMute} aria-label={muted() ? "Activar sonido" : "Silenciar"}>
            {muted() ? <VolumeX /> : <Volume2 />}
          </button>
          <button class="st-play" onClick={toggleFull} aria-label={isFull() ? "Salir de pantalla completa" : "Pantalla completa"}>
            {isFull() ? <Minimize /> : <Maximize />}
          </button>
        </div>
        </div>
        <Show when={(job.elements ?? []).length || srcVideo() || motionPlan()}>
          <div class="st-elements" aria-label="Entrada del edit">
            <Show when={srcVideo()}><span class="st-chip src">▸ {srcVideo().name ?? "video"}</span></Show>
            <Show when={motionPlan()}><span class="st-chip src">▸ motion · lienzo libre · {motionPlan().scenes.length} escenas · v{compVersion()}{mJob()?.input?.referenceImages?.length ? ` · ${mJob().input.referenceImages.length} ref` : ""}{mJob()?.input?.hasVideoReference ? " · video ref" : ""}</span></Show>
            <Show when={motionSnap}><span class="st-chip">{motionSnap.state} {Math.round((motionSnap.progress || 0) * 100)}%</span></Show>
            <For each={job.elements ?? []}>{(e) => <span class="st-chip">{e}</span>}</For>
          </div>
        </Show>
      </main>
    </div>
  );
}
