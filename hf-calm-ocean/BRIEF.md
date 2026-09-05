---
workflow: general-video
flow: automation
storyboard: "no"
message: "How AI answers: the most likely next word, computed at massive scale"
destination: local-file
aspect: 658x1080
language: en
length: 38s
angle: recut
---

## Intent

Recut of a 42s vertical talking-head interview about how LLMs work. Tighten it
by removing silences, dress it TikTok-style (karaoke captions, kinetic
callouts) without changing what is said. Direct, punchy, faithful to the
footage.

## Assets

- assets/source.mp4 — the original 42.2s vertical interview (658x1080, H.264).
- assets/fonts/montserrat-800-latin.woff2 — Montserrat ExtraBold, bundled local
  (caption preset needs it; no render-time network).
- transcript.json — faster-whisper small, 128 words with word timings.

## Customizations

- Remove silences: lead 0-1.44s + 4 pauses >= 0.44s (3.78s total) via hard cuts.
- Captions: caption-highlight preset design (red bg sweep, uppercase karaoke).
- Motion graphics: title open, 2 pull-quote callouts (exact transcript quotes),
  end card with craft label.
- Effects: alternating punch-ins per clip (mask jump cuts), fade in/out.
- Transitions: hard cuts on the beat of speech + punch-ins + fades.

## Notes

- No stock, no music bed, no name lower-third (unverified); quotes are exact
  transcript words. Quotes: "mathematically most likely answer",
  "hold these two simultaneous ideas".
