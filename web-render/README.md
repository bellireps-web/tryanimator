# web-render harness (Slice 2)

Deterministic browser render pipeline for Motion plans. Zero dependencies;
Web standards only.

## Layout

- `src/clock.js` — frame clock (`t = n/30`), frame counts, render segments
  (bounded memory for 60s = 1800 frames max).
- `src/presets.js` — HyperFrames style catalog (pinned versions).
- `src/resolve.js` — **pure** `(plan, t, dims) -> draw ops`. All layout,
  easing, transitions (cut/fade/slide over a 0.4s window), brand cycling and
  Ken Burns factors are decided here with absolute numbers only.
- `src/paint.js` — thin Canvas2D interpreter (browser-only).
- `src/index.js` — `renderFrame` + `encodeSegment` (H.264 via WebCodecs).

## Contracts enforced (structured errors, never silent blanks)

`style_unresolved` (Auto must be resolved first), `version_mismatch`
(plan pins a preset version the harness doesn't have), `unknown_preset`,
`unknown_transition`, `unknown_visual`, `image_not_loaded`,
`authored_not_supported`, `time_out_of_range`, `no_video_encoder`.

## Tests

```sh
node --test web-render/test/resolve.test.js   # 12 tests, pure, no DOM
```

## Explicitly pending (needs network / browser binaries)

1. **Vendored HyperFrames**: presets here are data + local painters until
   the framework package can be vendored; `authored` scene docs then execute
   for real instead of reporting `authored_not_supported`.
2. **Pixel goldens**: `resolve.js` is written so every decision is hashable,
   but capturing canvas pixels needs a real browser (none available here).
   Run `renderFrame` at fixed timestamps and hash the RGBA bytes.
3. **MP4 mux**: `encodeSegment` proves the VideoEncoder path; muxing waits
   for mediabunny (MPL-2.0 — license review per project rule before adding).
4. **GSAP**: the spec's capture view loads it from CDN; the offline render
   clock never depends on it.
