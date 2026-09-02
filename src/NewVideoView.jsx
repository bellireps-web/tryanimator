import { createSignal } from "solid-js";
import "./studio.css";

export const RATIOS = ["9:16", "16:9", "1:1", "4:3"];

export default function NewVideoView({ initial, onSubmit }) {
  const [prompt, setPrompt] = createSignal(initial?.prompt ?? "");
  const [ratio, setRatio] = createSignal(initial?.ratio ?? "9:16");
  const ready = () => prompt().trim().length > 0;
  const submit = () => { if (ready()) onSubmit({ prompt: prompt().trim(), ratio: ratio() }); };

  return (
    <div class="nv-page">
      <div class="nv-card">
        <h1>Nuevo video</h1>
        <p>Describe el video y elige su ratio. Enter lo envía a generar.</p>
        <label class="nv-label" for="nv-prompt">Prompt</label>
        <textarea
          id="nv-prompt"
          class="nv-prompt"
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Describe what you want in your video"
          aria-label="Describe your video"
        />
        <div class="nv-hint">Enter ↵ envía · Shift+Enter salto de línea</div>
        <span class="nv-label" id="nv-ratio-label">Ratio</span>
        <div class="nv-ratios" role="group" aria-labelledby="nv-ratio-label">
          {RATIOS.map((r) => (
            <button class="nv-ratio" data-r={r} aria-pressed={ratio() === r} onClick={() => setRatio(r)}>
              <span class="rect" aria-hidden="true" /><span>{r}</span>
            </button>
          ))}
        </div>
        <button class="nv-submit" disabled={!ready()} onClick={submit}>Generar video</button>
      </div>
    </div>
  );
}
