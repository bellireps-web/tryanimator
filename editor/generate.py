#!/usr/bin/env python3
"""Animator HyperFrames editor — plan generator (v0).

Entrada unica para UI manual y agente IA:
  transcript.json (word timings) -> plan.json -> index.html (composicion HF).

- Silencios: gaps entre palabras >= SILENCE_MIN (hard-cut recipe).
- Muletillas: busqueda de tokens (se registran para corte manual).
- Captions: una card por frase, tiempos mapeados a timeline (tras cortes).
- B-rolls: mapeo editorial frase -> imagen (editable en plan.json).
- Audio: clips pegados edge-to-edge (split/splice + trim recipes).

Regenerar:  python3 editor/generate.py
Render (en tu maquina):  cd editor && npx hyperframes lint && npx hyperframes check
"""
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TRANSCRIPT = os.path.join(ROOT, "transcript.json")
PLAN_OUT = os.path.join(HERE, "plan.json")
PUBLIC_OUT = os.path.join(ROOT, "public", "plan.json")  # copia servida (derivada) para la UI
HTML_OUT = os.path.join(HERE, "index.html")

SILENCE_MIN = 0.30  # gaps >= esto se cortan
LEAD_TRIM = 0.15    # se recorta el lead si supera esto (via data-media-start)
FILLERS = {"um", "uh", "eh", "mmm", "mm", "hmm", "uhm", "er", "ah", "este", "pues"}

# (indice de frase 0-based, fichero) — placeholder editorial, editable en plan.json
BROLL_MAP = [(1, "media/broll-1.png"), (3, "media/broll-2.png"), (5, "media/broll-3.png")]

W, H = 1080, 1920
COMP_ID = "animator-promo"


def r3(x):
    return round(float(x), 3)


def main():
    words = json.load(open(TRANSCRIPT))  # [{text, start, end}]
    assert words, "transcript vacio"

    # --- cortes: silencios + trims ---
    cuts = []
    if words[0]["start"] > LEAD_TRIM:
        cuts.append({"type": "trim-in", "sourceStart": 0.0, "sourceEnd": r3(words[0]["start"])})
    for a, b in zip(words, words[1:]):
        gap = b["start"] - a["end"]
        if gap >= SILENCE_MIN:
            cuts.append({"type": "silence", "sourceStart": r3(a["end"]), "sourceEnd": r3(b["start"])})
    span_start = cuts[0]["sourceEnd"] if cuts and cuts[0]["type"] == "trim-in" else 0.0
    span_end = words[-1]["end"]
    trims = [c for c in cuts if c["type"] != "silence"]
    silences = [c for c in cuts if c["type"] == "silence"]

    def shift(t):
        removed = sum(c["sourceEnd"] - c["sourceStart"] for c in cuts if c["sourceEnd"] <= t)
        return t - removed

    # --- muletillas (deteccion, no auto-corte en v0) ---
    fillers = [
        {"word": w["text"], "sourceStart": w["start"], "sourceEnd": w["end"]}
        for w in words
        if w["text"].strip(".,!?;:\"()").lower() in FILLERS
    ]

    # --- frases -> captions (tiempos de timeline) ---
    sentences, current = [], []
    for w in words:
        current.append(w)
        if w["text"][-1:] in (".", "!", "?"):
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)

    captions = []
    for s in sentences:
        s0, s1 = s[0]["start"], s[-1]["end"]
        # partir por cortes que caigan dentro de la frase
        bounds = [s0] + [c["sourceEnd"] for c in silences if s0 < c["sourceEnd"] < s1]
        bounds += [c["sourceStart"] for c in silences if s0 < c["sourceStart"] < s1] + [s1]
        bounds = sorted(set(bounds))
        text = " ".join(w["text"] for w in s)
        for a, b in zip(bounds, bounds[1:]):
            if any(c["sourceStart"] <= a and b <= c["sourceEnd"] for c in silences):
                continue  # fragmento dentro de un silencio: se descarta
            if b - a < 0.2:
                continue
            captions.append({"text": text, "t0": r3(shift(a)), "t1": r3(shift(b))})

    # --- rangos kept -> clips de audio ---
    kept = []
    cursor = span_start
    for c in silences:
        if c["sourceStart"] > cursor:
            kept.append((cursor, c["sourceStart"]))
        cursor = max(cursor, c["sourceEnd"])
    if cursor < span_end:
        kept.append((cursor, span_end))

    duration = r3(sum(e - s for s, e in kept))
    audio_clips = [
        {"id": f"ap-voice-{i}", "src": "media/voiceover.wav",
         "start": r3(shift(s)), "duration": r3(e - s), "mediaStart": r3(s)}
        for i, (s, e) in enumerate(kept)
    ]

    # --- b-rolls (tiempos de timeline) ---
    brolls = []
    for sent_idx, src in BROLL_MAP:
        if sent_idx >= len(sentences):
            continue
        s = sentences[sent_idx]
        t0, t1 = r3(shift(s[0]["start"])), r3(shift(s[-1]["end"]))
        if t1 - t0 >= 1.0:
            brolls.append({"id": f"ap-broll-{len(brolls)}", "src": src, "t0": t0, "t1": t1})

    plan = {
        "compositionId": COMP_ID, "width": W, "height": H,
        "source": {"transcript": "transcript.json", "audio": "media/voiceover.wav"},
        "silenceMin": SILENCE_MIN,
        "cuts": cuts, "trims": trims, "fillers": fillers,
        "keptRanges": [{"sourceStart": r3(s), "sourceEnd": r3(e)} for s, e in kept],
        "audioClips": audio_clips,
        "captions": captions, "brolls": brolls,
        "timelineDuration": duration,
        "generatedBy": "editor/generate.py",
    }
    json.dump(plan, open(PLAN_OUT, "w"), indent=2, ensure_ascii=False)
    json.dump(plan, open(PUBLIC_OUT, "w"), indent=2, ensure_ascii=False)

    open(HTML_OUT, "w").write(render_html(plan))
    print(f"cortes silencio: {len(silences)} ({sum(c['sourceEnd']-c['sourceStart'] for c in silences):.2f}s), "
          f"muletillas: {len(fillers)}, captions: {len(captions)}, brolls: {len(brolls)}, "
          f"duracion: {span_end:.1f}s -> {duration:.1f}s")


def render_html(plan):
    d = plan["timelineDuration"]
    parts = []
    parts.append("<!doctype html>")
    parts.append('<html lang="en">')
    parts.append("<head>")
    parts.append('<meta charset="UTF-8" />')
    parts.append(f"<title>Animator promo ({COMP_ID})</title>")
    parts.append('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>')
    parts.append("<style>")
    parts.append("  body { margin: 0; background: #060511; color: #fff; font-family: Figtree, system-ui, sans-serif; }")
    parts.append(f"  #ap-root {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; background: #060511; }}")
    parts.append("  .clip { position: absolute; inset: 0; }")
    parts.append("  #ap-title { display: grid; place-items: center; text-align: center; }")
    parts.append("  #ap-title .inner { display: flex; flex-direction: column; align-items: center; gap: 28px; }")
    parts.append("  #ap-title img { width: 220px; height: 220px; }")
    parts.append("  #ap-title h1 { margin: 0; font-size: 120px; line-height: 1.05; }")
    parts.append("  #ap-title p { margin: 0; font-size: 44px; color: #A9A6C6; }")
    parts.append("  .ap-broll img { width: 100%; height: 100%; object-fit: cover; display: block; }")
    parts.append("  .ap-cap { display: flex; align-items: flex-end; justify-content: center; }")
    parts.append("  .ap-cap span { display: block; max-width: 920px; margin-bottom: 300px; padding: 28px 40px; "
                 "font-size: 52px; line-height: 1.25; font-weight: 600; text-align: center; "
                 "background: rgba(6,5,17,.72); border-radius: 28px; }")
    parts.append("</style>")
    parts.append("</head>")
    parts.append("<body>")
    parts.append(f'  <div id="ap-root" data-composition-id="{COMP_ID}" data-start="0" '
                 f'data-width="{W}" data-height="{H}" data-duration="{d}">')

    # titulo (track 1)
    parts.append('    <section id="ap-title" class="clip" data-start="0" data-duration="2" data-track-index="1">')
    parts.append('      <div class="inner"><img id="ap-logo" src="media/logo.png" alt="Animator" />'
                 "<h1>Animator</h1><p>The AI that edits in one click</p></div>")
    parts.append("    </section>")

    # b-rolls (track 0)
    for b in plan["brolls"]:
        dur = r3(b["t1"] - b["t0"])
        parts.append(f'    <div id="{b["id"]}" class="clip ap-broll" data-start="{b["t0"]}" '
                     f'data-duration="{dur}" data-track-index="0">')
        parts.append(f'      <img class="inner" src="{b["src"]}" alt="" />')
        parts.append("    </div>")

    # captions (track 5)
    for i, c in enumerate(plan["captions"]):
        dur = r3(c["t1"] - c["t0"])
        parts.append(f'    <div id="ap-cap-{i}" class="clip ap-cap" data-start="{c["t0"]}" '
                     f'data-duration="{dur}" data-track-index="5">')
        parts.append(f"      <span>{html.escape(c['text'])}</span>")
        parts.append("    </div>")

    # voz (track 10, receta hard-cut: rangos pegados + mismo media-start)
    for a in plan["audioClips"]:
        parts.append(f'    <audio id="{a["id"]}" src="{a["src"]}" data-start="{a["start"]}" '
                     f'data-duration="{a["duration"]}" data-media-start="{a["mediaStart"]}" '
                     f'data-track-index="10"></audio>')

    parts.append("  </div>")
    parts.append("  <script>")
    parts.append("    const tl = gsap.timeline({ paused: true });")
    parts.append('    tl.fromTo("#ap-title .inner", { y: 40, opacity: 0 }, '
                 '{ y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.1);')
    for i, c in enumerate(plan["captions"]):
        parts.append(f'    tl.fromTo("#ap-cap-{i} span", {{ y: 30, opacity: 0 }}, '
                     f'{{ y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }}, {c["t0"] + 0.02});')
    for b in plan["brolls"]:
        dur = r3(b["t1"] - b["t0"])
        parts.append(f'    tl.fromTo("#{b["id"]} .inner", {{ scale: 1 }}, '
                     f'{{ scale: 1.08, duration: {dur}, ease: "none" }}, {b["t0"]});')
    parts.append(f'    window.__timelines["{COMP_ID}"] = tl;')
    parts.append("  </script>")
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts) + "\n"


if __name__ == "__main__":
    main()
