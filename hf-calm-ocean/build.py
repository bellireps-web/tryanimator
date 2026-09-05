#!/usr/bin/env python3
"""Build hf-calm-ocean/index.html from transcript.json (deterministic).

Cuts silences via hard-cut clips, karaoke captions (caption-highlight design),
title/callouts/endcard, punch-ins, fades. All tween positions are baked
timeline seconds — no runtime computation of timing.
"""
import json
import html as htmllib

ROOT = __file__.rsplit("/", 1)[0]
WORDS = json.load(open(f"{ROOT}/transcript.json"))
SRC_DUR = 42.2

CUTS = [(0.0, 1.44), (7.72, 8.28), (18.84, 19.28), (27.54, 28.28), (34.40, 35.00)]
SIL_MIN = 0.30


def r3(x):
    return round(float(x), 3)


# --- kept ranges -> clips (timeline) ---
kept = []
cursor = 0.0
for c0, c1 in sorted(CUTS):
    if c0 > cursor:
        kept.append((cursor, c0))
    cursor = max(cursor, c1)
if cursor < SRC_DUR:
    kept.append((cursor, SRC_DUR))
# drop tail silence beyond last word
last_end = WORDS[-1]["end"]
kept = [(a, min(b, last_end)) for a, b in kept if a < last_end]

clips = []
t = 0.0
for a, b in kept:
    clips.append({"src": r3(a), "tl": r3(t), "dur": r3(b - a)})
    t += b - a
DUR = r3(t)


def shift(s):
    """source seconds -> timeline seconds (words never span cuts)."""
    for c in clips:
        if c["src"] <= s < c["src"] + c["dur"] + 1e-6:
            return c["tl"] + (s - c["src"])
    # word end exactly at range end
    for c in clips:
        if abs(s - (c["src"] + c["dur"])) < 1e-6:
            return c["tl"] + c["dur"]
    raise ValueError(f"time {s} in a cut")


def toks(w):
    return w["text"].strip(".,!?;:\"()").lower()


# --- caption groups: <=4 words, break on sentence end, split at cuts ---
raw_groups = []
cur = []
for i, w in enumerate(WORDS):
    cur.append(i)
    if len(cur) >= 4 or w["text"][-1:] in (".", "!", "?"):
        raw_groups.append(cur)
        cur = []
if cur:
    raw_groups.append(cur)


def word_range(i):
    for k, c in enumerate(clips):
        if c["src"] <= WORDS[i]["start"] < c["src"] + c["dur"] + 1e-6:
            return k
    raise ValueError(f"word {i} in a cut")


groups = []
for g in raw_groups:
    part = [g[0]]
    for i in g[1:]:
        if word_range(i) != word_range(part[-1]):
            groups.append(part)
            part = [i]
        else:
            part.append(i)
    groups.append(part)

G = []
for g in groups:
    s = r3(shift(WORDS[g[0]]["start"]))
    e = r3(shift(WORDS[g[-1]]["end"]))
    G.append({"words": g, "start": s, "end": e})
for k, g in enumerate(G):
    nxt = G[k + 1]["start"] if k + 1 < len(G) else DUR
    g["end"] = r3(min(g["end"] + 0.45, nxt - 0.05))


def find_quote(phrase):
    pt = [p.lower() for p in phrase.split()]
    ws = [toks(w) for w in WORDS]
    for i in range(len(ws) - len(pt) + 1):
        if ws[i:i + len(pt)] == pt:
            s = r3(shift(WORDS[i]["start"]))
            e = r3(shift(WORDS[i + len(pt) - 1]["end"]))
            return {"words": [WORDS[j]["text"] for j in range(i, i + len(pt))],
                    "start": s, "end": e}
    raise ValueError(f"quote not found: {phrase}")


Q1 = find_quote("mathematically most likely answer")
Q2 = find_quote("hold these two simultaneous ideas")

TITLE = {"start": 0.0, "end": 2.6}
END = {"start": r3(DUR - 2.2), "end": DUR}
# captions never play under the opaque endcard: drop groups fully inside it,
# clamp + trim words of groups crossing its start.
G2 = []
for g in G:
    if g["start"] >= END["start"] - 0.05:
        continue
    words = [i for i in g["words"] if WORDS[i]["start"] and shift(WORDS[i]["start"]) < END["start"] - 0.1]
    if not words:
        continue
    end = r3(min(g["end"], END["start"] - 0.05))
    if end > g["start"] + 0.3:
        G2.append({"words": words, "start": g["start"], "end": end})
G = G2
C1 = {"start": r3(max(0, Q1["start"] - 0.15)), "end": r3(Q1["end"] + 0.55)}
C2 = {"start": r3(max(0, Q2["start"] - 0.15)), "end": r3(Q2["end"] + 0.55)}

words_js = ",\n          ".join(
    '{ text: %s, start: %s, end: %s }' % (
        json.dumps(w["text"]), r3(shift(w["start"])), r3(shift(w["end"])))
    for w in WORDS)
groups_js = ",\n          ".join(
    "[%s]" % ",".join(str(i) for i in g["words"]) for g in G)
gwin_js = ",\n          ".join(
    "{ start: %s, end: %s }" % (g["start"], g["end"]) for g in G)

W, H = 658, 1080
scales = [1.0, 1.07, 1.0, 1.07, 1.0, 1.07]

parts = []
A = parts.append
A("<!doctype html>")
A('<html lang="en">')
A("<head>")
A('<meta charset="UTF-8" />')
A('<meta name="viewport" content="width=658, height=1080" />')
A("<title>Calm Ocean recut — 42s to 38s</title>")
A('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>')
A("<style>")
A("  @font-face { font-family: 'Montserrat'; font-style: normal; font-weight: 800; font-display: swap;")
A("    src: url('assets/fonts/montserrat-800-latin.woff2') format('woff2'); }")
A("  * { margin: 0; padding: 0; box-sizing: border-box; }")
A("  html, body { margin: 0; width: 658px; height: 1080px; overflow: hidden; background: #000; }")
A("  body { font-family: Montserrat, 'Arial Black', sans-serif; }")
A('  #main { position: relative; width: 658px; height: 1080px; overflow: hidden; background: #000; }')
A("  .clip { position: absolute; inset: 0; overflow: hidden; }")
A("  .zoomwrap { position: absolute; inset: 0; overflow: hidden; }")
A("  .zoomwrap video { width: 100%; height: 100%; object-fit: cover; display: block; }")
A("  #fade { position: absolute; inset: 0; background: #000; z-index: 30; opacity: 1; pointer-events: none; }")
# captions (caption-highlight design, vertical scale)
A("  #cap-layer { position: absolute; inset: 0; z-index: 10; pointer-events: none; }")
A("  .cap-group { position: absolute; bottom: 120px; left: 0; width: 100%; display: flex; flex-wrap: wrap;")
A("    align-items: flex-end; justify-content: center; gap: 6px; padding: 0 36px; opacity: 0; visibility: hidden; }")
A('  .cap-word { font-family: Montserrat, "Arial Black", sans-serif; font-weight: 800; font-size: 54px;')
A("    text-transform: uppercase; color: #fff; display: inline-block; letter-spacing: 0.02em; line-height: 1.12;")
A("    position: relative; padding: 4px 9px 6px; text-shadow: 0 4px 14px rgba(0,0,0,.5);")
A("    transform-origin: 50% 58%; will-change: transform, filter; }")
A("  .cap-word-bg { position: absolute; inset: 0; background: linear-gradient(135deg, #ff1745 0%, #df1238 100%);")
A("    border-radius: 8px; box-shadow: 0 8px 22px rgba(229,20,58,.32); opacity: 0;")
A("    transform: scaleX(0); transform-origin: 0% 50%; z-index: -1; }")
A("  .cap-word-text { position: relative; z-index: 1; }")
# title / callouts / endcard
A("  .gfx { position: absolute; left: 0; width: 100%; z-index: 11; pointer-events: none; opacity: 0; }")
A('  #title { top: 120px; text-align: center; }')
A('  #title .scrim { position: absolute; inset: -40px 0; background: linear-gradient(180deg, rgba(6,5,17,.72), rgba(6,5,17,0)); z-index: -1; }')
A('  .kicker { color: #B8B2EE; font-size: 22px; font-weight: 800; letter-spacing: .32em; }')
A('  #title h1 { color: #F5F3FF; font-size: 72px; font-weight: 800; line-height: 1.04; margin-top: 12px; }')
A('  .callout { top: 610px; display: flex; justify-content: center; }')
A('  .callout .card { max-width: 560px; background: rgba(6,5,17,.84); border-left: 8px solid #B8B2EE;')
A('    border-radius: 14px; padding: 16px 22px; color: #F5F3FF; font-size: 32px; font-weight: 800; line-height: 1.2; }')
A('  .callout .who { display: block; color: #B8B2EE; font-size: 20px; letter-spacing: .28em; margin-bottom: 10px; }')
A('  #endcard { inset: 0; top: 0; height: 1080px; background: #1F1B46; display: flex; flex-direction: column;')
A('    align-items: center; justify-content: center; gap: 14px; text-align: center; }')
A('  #endcard .big { color: #F5F3FF; font-size: 120px; font-weight: 800; line-height: 1; }')
A('  #endcard .mid { color: #B8B2EE; font-size: 30px; font-weight: 800; letter-spacing: .24em; }')
A('  #endcard .small { color: #A9A6C6; font-size: 22px; font-weight: 800; letter-spacing: .18em; }')
# graphic layer: progress, cut sweeps, badges, rings (no extra copy)
A("  #progress { position: absolute; top: 0; left: 0; width: 100%; height: 8px; z-index: 12; pointer-events: none; }")
A("  #progress .fill { position: absolute; inset: 0; background: #B8B2EE; transform-origin: 0% 50%; }")
A("  #progress .tick { position: absolute; top: -3px; width: 4px; height: 14px; background: #F5F3FF; border-radius: 2px; }")
A("  #sweep { position: absolute; left: 0; top: 46%; width: 100%; height: 8px; background: #B8B2EE;")
A("    z-index: 9; pointer-events: none; opacity: 0; }")
A("  #flash { position: absolute; inset: 0; background: #fff; z-index: 15; pointer-events: none; opacity: 0; }")
A("  .kbadge { display: flex; align-items: center; gap: 18px; max-width: 560px; background: rgba(6,5,17,.84);")
A("    border-radius: 18px; padding: 16px 24px 16px 16px; }")
A("  .kbadge svg.ring { width: 92px; height: 92px; flex: 0 0 92px; }")
A("  .kbadge .kw { color: #F5F3FF; font-size: 34px; font-weight: 800; line-height: 1.15; }")
A("  .kbadge .kw small { display: block; color: #B8B2EE; font-size: 18px; letter-spacing: .28em; margin-bottom: 6px; }")
A("  #title-rule { width: 300px; height: 8px; background: #B8B2EE; border-radius: 4px; margin: 16px auto 0; }")
A("  #title-halo { position: absolute; left: 50%; top: 96px; width: 420px; height: 420px; margin-left: -210px; z-index: -1; opacity: .5; }")
A("  .ering { position: absolute; left: 50%; top: 50%; margin: -260px 0 0 -260px; width: 520px; height: 520px; opacity: .55; }")
A("</style>")
A("</head>")
A("<body>")
A('  <div id="main" data-composition-id="main" data-start="0" data-duration="%s"' % DUR)
A('       data-fps="30" data-width="658" data-height="1080">')

for i, c in enumerate(clips):
    A('    <div id="shot-%d-visual" class="zoomwrap">' % i)
    A('      <video id="v-%d" src="assets/source.mp4" data-start="%s" data-duration="%s" data-media-start="%s" data-track-index="0" muted playsinline></video>' % (i, c["tl"], c["dur"], c["src"]))
    A("    </div>")
    auto = ""
    if i == len(clips) - 1:
        auto = (' data-automation=\'{"version":1,"lanes":[{"target":"volume","points":'
                '[{"t":0,"v":1},{"t":%s,"v":1},{"t":%s,"v":0}]}]}\'' % (r3(c["dur"] - 1.0), c["dur"]))
    A('    <audio id="a-%d" src="assets/source.mp4" data-start="%s" data-duration="%s" data-media-start="%s" data-track-index="10"%s></audio>'
      % (i, c["tl"], c["dur"], c["src"], auto))

A('    <div id="cap-layer"></div>')
A('    <div id="title" class="gfx"><div class="scrim"></div>')
A('      <svg id="title-halo" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke="#B8B2EE" stroke-width="1.2" stroke-dasharray="5 8"/></svg>')
A('      <div class="kicker">AI &middot; EXPLAINED</div><h1>HOW AI<br/>ANSWERS</h1><div id="title-rule"></div></div>')
RING = ('<svg class="ring" id="%s-ring" viewBox="0 0 100 100">'
        '<circle cx="50" cy="50" r="44" fill="none" stroke="#B8B2EE" stroke-width="7" stroke-dasharray="20 13"/>'
        '<circle cx="50" cy="50" r="30" fill="none" stroke="#F5F3FF" stroke-width="2" opacity=".45"/></svg>')
KW = {"co1": ("01", "MOST LIKELY<br/>ANSWER"), "co2": ("02", "TWO SIMULTANEOUS<br/>IDEAS")}
for cid, q in (("co1", C1), ("co2", C2)):
    num, kw = KW[cid]
    A('    <div id="%s" class="gfx callout"><div class="kbadge">%s<div class="kw"><small>KEY IDEA &middot; %s</small>%s</div></div></div>'
      % (cid, RING % cid, num, kw))
    A('    <!-- window %s -> %s -->' % (q["start"], q["end"]))
A('    <div id="endcard" class="gfx">'
  '<svg class="ering" id="er1" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke="#B8B2EE" stroke-width="1" stroke-dasharray="4 6"/></svg>'
  '<svg class="ering" id="er2" viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="none" stroke="#F5F3FF" stroke-width="1" stroke-dasharray="2 5" opacity=".6"/></svg>'
  '<div class="mid">RECUT</div>')
A('      <div class="big">42s<br/>&rarr; 38s</div>')
A('      <div class="small">SILENCES REMOVED &middot; CAPTIONS ON</div></div>')
ticks = "".join('<span class="tick" style="left:%.2f%%"></span>' % (c["tl"] / DUR * 100)
                for c in clips[1:])
A('    <div id="progress"><div class="fill" id="progress-fill"></div>%s</div>' % ticks)
A('    <div id="sweep"></div>')
A('    <div id="flash"></div>')
A('    <div id="fade"></div>')
A("  </div>")
A("  <script>")
A("  (function () {")
A("    window.__timelines = window.__timelines || {};")
A('    var _fit = document.createElement("canvas").getContext("2d");')
A("    function fitFontSize(text, base, weight, family, maxW) {")
A('      var s = base, min = Math.floor(base * 0.45);')
A("      while (s > min) { _fit.font = weight + ' ' + s + 'px ' + family;")
A("        if (_fit.measureText(text).width <= maxW) return s; s -= 2; } return min; }")
A("    var WORDS = [\n          " + words_js + "\n        ];")
A("    var GROUPS = [\n          " + groups_js + "\n        ];")
A("    var GWIN = [\n          " + gwin_js + "\n        ];")
A('    var layer = document.getElementById("cap-layer");')
A("    var tl = gsap.timeline({ paused: true });")
# punch-ins (alternate, mask the hard cuts)
for i, c in enumerate(clips):
    A("    tl.fromTo('#shot-%d-visual', { scale: %s }, { scale: %s, duration: %s, ease: 'none' }, %s);"
      % (i, scales[i], scales[i + 1], c["dur"], c["tl"]))
# fades
A("    tl.fromTo('#fade', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.4, ease: 'power1.out' }, 0);")
A("    tl.fromTo('#progress-fill', { scaleX: 0 }, { scaleX: 1, duration: %s, ease: 'none' }, 0);" % DUR)
for c in clips[1:]:
    tc = c["tl"]
    A("    tl.fromTo('#sweep', { opacity: 1, scaleX: 0, transformOrigin: '0%% 50%%' },"
      " { scaleX: 1, opacity: 1, duration: 0.16, ease: 'power2.out' }, %s);" % r3(tc - 0.02))
    A("    tl.set('#sweep', { transformOrigin: '100%% 50%%' }, %s);" % r3(tc + 0.14))
    A("    tl.to('#sweep', { scaleX: 0, duration: 0.16, ease: 'power2.in' }, %s);" % r3(tc + 0.14))
    A("    tl.set('#sweep', { opacity: 0 }, %s);" % r3(tc + 0.32))
    A("    tl.fromTo('#flash', { autoAlpha: 0 }, { autoAlpha: 0.22, duration: 0.08 }, %s);" % r3(tc - 0.02))
    A("    tl.to('#flash', { autoAlpha: 0, duration: 0.18 }, %s);" % r3(tc + 0.06))
A("    tl.fromTo('#title-rule', { scaleX: 0, transformOrigin: '50%% 50%%' },"
  " { scaleX: 1, duration: 0.5, ease: 'power3.out' }, 0.5);")
A("    tl.fromTo('#title-halo', { rotation: 0, transformOrigin: '50%% 50%%' },"
  " { rotation: 120, duration: %s, ease: 'none' }, 0);" % TITLE["end"])
A("    tl.fromTo('#co1-ring', { rotation: 0, transformOrigin: '50%% 50%%' },"
  " { rotation: 180, duration: %s, ease: 'none' }, %s);" % (r3(C1["end"] - C1["start"]), C1["start"]))
A("    tl.fromTo('#co2-ring', { rotation: 0, transformOrigin: '50%% 50%%' },"
  " { rotation: 180, duration: %s, ease: 'none' }, %s);" % (r3(C2["end"] - C2["start"]), C2["start"]))
A("    tl.fromTo('#er1', { rotation: 0, transformOrigin: '50%% 50%%' },"
  " { rotation: -120, duration: %s, ease: 'none' }, %s);" % (r3(END["end"] - END["start"]), END["start"]))
A("    tl.fromTo('#er2', { rotation: 0, transformOrigin: '50%% 50%%' },"
  " { rotation: 90, duration: %s, ease: 'none' }, %s);" % (r3(END["end"] - END["start"]), END["start"]))
A("    tl.to('#fade', { autoAlpha: 1, duration: 0.6, ease: 'power1.in' }, %s);" % r3(DUR - 0.6))
# captions
A("    GROUPS.forEach(function (g, gi) {")
A("      var grp = document.createElement('div'); grp.className = 'cap-group'; grp.id = 'cap-grp-' + gi;")
A("      var gw = GWIN[gi];")
A("      var text = g.map(function (wi) { return WORDS[wi].text.toUpperCase(); }).join(' ');")
A("      var size = fitFontSize(text, 54, '800', 'Montserrat', 586);")
A("      g.forEach(function (wi) {")
A("        var wEl = document.createElement('span'); wEl.className = 'cap-word'; wEl.id = 'cap-w-' + wi;")
A("        wEl.style.fontSize = size + 'px';")
A("        var bg = document.createElement('span'); bg.className = 'cap-word-bg'; bg.id = 'cap-bg-' + wi;")
A("        var tx = document.createElement('span'); tx.className = 'cap-word-text'; tx.textContent = WORDS[wi].text.toUpperCase();")
A("        wEl.appendChild(bg); wEl.appendChild(tx); grp.appendChild(wEl); });")
A("      layer.appendChild(grp);")
A("      tl.set(grp, { visibility: 'visible' }, gw.start);")
A("      tl.fromTo(grp, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'power2.out' }, gw.start);")
A("      g.forEach(function (wi) {")
A("        var w = WORDS[wi];")
A("        var bg = document.getElementById('cap-bg-' + wi), wEl = document.getElementById('cap-w-' + wi);")
A("        tl.to(bg, { opacity: 1, scaleX: 1, duration: 0.15, ease: 'power2.out' }, w.start);")
A("        tl.to(bg, { opacity: 0, scaleX: 1.02, duration: 0.1, ease: 'power2.in' }, w.end);")
A("        tl.set(bg, { scaleX: 0 }, w.end + 0.1); });")
A("      tl.to(grp, { opacity: 0, duration: 0.1, ease: 'power2.in' }, gw.end - 0.1);")
A("      tl.set(grp, { opacity: 0, visibility: 'hidden' }, gw.end); });")
# gfx helper: simple in/out
A("    function card(id, s, e, dy) {")
A("      var el = document.getElementById(id);")
A("      tl.set(el, { visibility: 'visible' }, s);")
A("      tl.fromTo(el, { opacity: 0, y: dy }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }, s);")
A("      tl.to(el, { opacity: 0, duration: 0.25, ease: 'power2.in' }, e - 0.25);")
A("      tl.set(el, { opacity: 0, visibility: 'hidden' }, e); }")
A("    card('title', %s, %s, 30);" % (TITLE["start"], TITLE["end"]))
A("    card('co1', %s, %s, 26);" % (C1["start"], C1["end"]))
A("    card('co2', %s, %s, 26);" % (C2["start"], C2["end"]))
A("    card('endcard', %s, %s, 0);" % (END["start"], END["end"]))
A("    tl.seek(0);")
A('    window.__timelines["main"] = tl;')
A("  })();")
A("  </script>")
A("</body>")
A("</html>")

open(f"{ROOT}/index.html", "w").write("\n".join(parts) + "\n")
print(f"clips={len(clips)} dur={DUR} groups={len(G)} q1={C1} q2={C2}")
