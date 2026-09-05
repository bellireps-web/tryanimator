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
        <h1>New video</h1>
        <p>Describe the video and pick its ratio. Enter sends it to generate.</p>
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
        <div class="nv-hint">Enter ↵ sends · Shift+Enter for a new line</div>
        <span class="nv-label" id="nv-ratio-label">Ratio</span>
        <div class="nv-ratios" role="group" aria-labelledby="nv-ratio-label">
          {RATIOS.map((r) => (
            <button class="nv-ratio" data-r={r} aria-pressed={ratio() === r} onClick={() => setRatio(r)}>
              <span class="rect" aria-hidden="true" /><span>{r}</span>
            </button>
          ))}
        </div>
        <button class="nv-submit" disabled={!ready()} onClick={submit}>Generate video</button>
      </div>
    </div>
  );
}
