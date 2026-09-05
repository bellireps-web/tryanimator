# web-render harness (Slice 2)

Deterministic browser render pipeline for Motion plans. Zero dependencies;
Web standards only.

## Layout

- `src/clock.js` — frame clock (`t = n/30`), frame counts, render segments
  (bounded memory for 60s = 1800 frames max).
- `src/resolve.js` — **pure** `(plan, t, dims) -> draw ops`. Free canvas:
  background plus the scene visual (stock/asset image or authored doc id).
  All motion graphics come from authored docs executed by `authored.js`.
- `src/authored.js` — authored HyperFrames scene runtime (offscreen stage,
  captured GSAP timelines seeked by fraction, SVG foreignObject raster).
- `src/paint.js` — thin Canvas2D interpreter (browser-only).
- `src/index.js` — `renderFrame` + `renderFrameAsync` + `encodeSegment`
  (H.264 via WebCodecs).

## Contracts enforced (structured errors, never silent blanks)

`unknown_transition`, `unknown_visual`, `image_not_loaded`,
`authored_missing`, `authored_unavailable`, `authored_exec`,
`authored_raster`, `time_out_of_range`, `no_video_encoder`.

## Tests

```sh
node --test web-render/test/resolve.test.js   # 12 tests, pure, no DOM
```

## Explicitly pending (needs network / browser binaries)

1. **Authored fidelity**: webfont files cannot load inside the SVG-image
   raster (embedded Figtree data URLs cover the brand font); external
   images are inlined best-effort; per-frame serialize+raster costs
   ~10-50ms (absorbed by the segment cache on re-renders).
2. **Pixel goldens**: `resolve.js` is written so every decision is hashable,
   but capturing canvas pixels needs a real browser (none available here).
   Run `renderFrame` at fixed timestamps and hash the RGBA bytes.
3. **MP4 mux**: `encodeSegment` proves the VideoEncoder path; muxing waits
   for mediabunny (MPL-2.0 — license review per project rule before adding).
4. **GSAP**: the spec's capture view loads it from CDN; the offline render
   clock never depends on it.
