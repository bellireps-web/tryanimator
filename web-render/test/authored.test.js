import test from "node:test";
import assert from "node:assert/strict";
import {
  splitAuthoredDoc,
  captureTimelines,
  capturedDuration,
  seekCaptured,
  seekAtTime,
  runAuthoredScripts,
  minConsecutiveSpread,
  closeVoidElements,
  containsAuthored,
  expandAuthoredOps,
  guardCss,
  countEntranceTweens,
  hasStaggeredEntrances,
  meanAbsDiff,
  collectDocHooks,
  collectTweenSelectors,
  findDanglingSelectors,
} from "../src/authored.js";

const DOC = `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Figtree&display=swap" rel="stylesheet">
<script src="https://cdn/gsap.min.js"></script>
<style>.a{color:red}</style>
</head><body><div class="a">Hi</div><script>const tl = gsap.timeline(); tl.to(".a", {opacity: 1});</script></body></html>`;

test("splitAuthoredDoc separates styles, inline scripts and body", () => {
  const parts = splitAuthoredDoc(DOC);
  assert.deepEqual(parts.styles, [".a{color:red}"]);
  assert.equal(parts.inlineScripts.length, 1);
  assert.match(parts.inlineScripts[0], /gsap\.timeline/);
  assert.match(parts.body, /<div class="a">Hi<\/div>/);
  assert.ok(!parts.body.includes("<script"), "scripts stripped from body");
  assert.deepEqual(parts.stylesheets, ["https://fonts.googleapis.com/css2?family=Figtree&display=swap"]);

  const frag = splitAuthoredDoc("<div>x</div>");
  assert.match(frag.body, /<div>x<\/div>/);
  assert.deepEqual(frag.inlineScripts, []);
});

function fakeGsap() {
  const timelines = [];
  return {
    created: timelines,
    timeline() {
      const calls = [];
      const tl = {
        duration: () => 4,
        pause: () => calls.push(["pause"]),
        seek: (t, suppress) => calls.push(["seek", t, suppress]),
        kill: () => calls.push(["kill"]),
        calls,
      };
      timelines.push(tl);
      return tl;
    },
  };
}

test("captureTimelines records and seeks by fraction", () => {
  const { proxy, created } = captureTimelines(fakeGsap());
  const tl = proxy.timeline();
  assert.equal(created.timelines.length, 1);
  assert.equal(capturedDuration(created), 4);
  seekCaptured(created, 4, 0.5);
  assert.deepEqual(tl.calls[0], ["pause"]);
  assert.deepEqual(tl.calls[1], ["seek", 2, false]);
  // Bounds clamp.
  seekCaptured(created, 4, 9);
  assert.deepEqual(tl.calls[tl.calls.length - 1], ["seek", 4, false]);
});

test("seekAtTime seeks exact seconds for exact-length timelines", () => {
  const { proxy, created } = captureTimelines(fakeGsap());
  const tl = proxy.timeline();
  seekAtTime(created, 3);
  assert.deepEqual(tl.calls[0], ["pause"]);
  assert.deepEqual(tl.calls[1], ["seek", 3, false]);
});

test("guardCss pins the page to the exact frame", () => {
  const css = guardCss(608, 1080, "#123456");
  assert.match(css, /width:608px/);
  assert.match(css, /height:1080px/);
  assert.match(css, /background:#123456/);
  assert.match(css, /margin:0/);
  assert.match(guardCss(0, -5), /width:1px/);
  assert.match(guardCss(100, 100), /background:#060511/);
});

test("entrance detection requires staggered froms", () => {
  const good = '<div class="a">Hi</div><script>gsap.from(".a",{opacity:0});gsap.fromTo(".b",{y:10},{y:0});</script>';
  assert.deepEqual(countEntranceTweens(good).froms, 2);
  assert.equal(hasStaggeredEntrances(good), true);

  const onePlusHidden =
    '<style>.a{opacity:0}</style><div class="a">Hi</div><script>gsap.from(".a",{opacity:0});</script>';
  assert.equal(hasStaggeredEntrances(onePlusHidden), true);

  const inlineHidden =
    '<div class="a" style="opacity:0">Hi</div><script>gsap.from(".a",{opacity:0});</script>';
  assert.equal(countEntranceTweens(inlineHidden).hiddenInit, true);
  assert.equal(hasStaggeredEntrances(inlineHidden), true);

  const flat = "<div>full layout</div><script>gsap.to('.a',{x:10});</script>";
  assert.equal(hasStaggeredEntrances(flat), false);
  assert.equal(hasStaggeredEntrances(""), false);
  assert.equal(hasStaggeredEntrances(null), false);
});

test("runAuthoredScripts tolerates window listener/rAF shims", async () => {
  const fakeGsap = { timeline: () => ({ duration: () => 1, pause: () => {}, seek: () => {}, kill: () => {} }) };
  const created = await runAuthoredScripts(
    ["window.addEventListener('load',()=>{}); window.removeEventListener('load',()=>{}); window.requestAnimationFrame(()=>{}); window.cancelAnimationFrame(0);"],
    { gsapImpl: fakeGsap, stagedDocument: {}, width: 100, height: 100 },
  );
  assert.ok(created, "scripts using shims execute without failing");
});

test("runAuthoredScripts fires deferred load init so timelines are captured", async () => {
  const timelines = [];
  const fakeGsap = {
    timeline: () => {
      const tl = { duration: () => 4, pause: () => {}, seek: () => {}, kill: () => {} };
      timelines.push(tl);
      return tl;
    },
  };
  const created = await runAuthoredScripts(
    ["window.addEventListener('load',()=>{gsap.timeline();});"],
    { gsapImpl: fakeGsap, stagedDocument: {}, width: 100, height: 100 },
  );
  assert.equal(timelines.length, 1, "load-deferred init still registers its timeline");
  assert.equal(created.timelines.length, 1);
});

test("runAuthoredScripts replays DOMContentLoaded only when nothing registered", async () => {
  const timelines = [];
  const fakeGsap = {
    timeline: () => {
      const tl = { duration: () => 4, pause: () => {}, seek: () => {}, kill: () => {} };
      timelines.push(tl);
      return tl;
    },
  };
  let saved = null;
  const fakeDoc = {
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of this.listeners[ev.type] || []) fn();
    },
  };
  const created = await runAuthoredScripts(
    ["document.addEventListener('DOMContentLoaded',()=>{gsap.timeline();});"],
    { gsapImpl: fakeGsap, stagedDocument: fakeDoc, width: 100, height: 100 },
  );
  assert.equal(timelines.length, 1, "missed DOMContentLoaded still initializes");
  assert.equal(created.timelines.length, 1);

  const timelines2 = [];
  const fakeGsap2 = {
    timeline: () => {
      const tl = { duration: () => 1, pause: () => {}, seek: () => {}, kill: () => {} };
      timelines2.push(tl);
      return tl;
    },
  };
  let replayed = 0;
  const fakeDoc2 = {
    addEventListener: () => {},
    dispatchEvent: () => {
      replayed += 1;
    },
  };
  await runAuthoredScripts(["gsap.timeline();"], {
    gsapImpl: fakeGsap2,
    stagedDocument: fakeDoc2,
    width: 100,
    height: 100,
  });
  assert.equal(timelines2.length, 1);
  assert.equal(replayed, 0, "no replay when init already ran");
});

test("minConsecutiveSpread takes the weakest early window", () => {
  assert.equal(minConsecutiveSpread([]), 0);
  assert.equal(minConsecutiveSpread([0.05, 0.001, 0.09]), 0.001);
  assert.equal(minConsecutiveSpread([0.05, 0.09]), 0.05);
});

test("findDanglingSelectors flags tweens on missing elements", () => {
  const ok =
    '<div id="stage" class="card">x</div>' +
    '<script>gsap.to("#stage",{x:1});gsap.from(".card",{opacity:0});document.querySelector("#stage");const el=document.getElementById("stage");</script>';
  assert.deepEqual(findDanglingSelectors(ok), []);

  const bad =
    '<div id="stage">x</div>' +
    '<script>gsap.to("#stage",{x:1});gsap.to("#bgShift",{x:2});tl.from(".glow",{opacity:0});</script>';
  assert.deepEqual(findDanglingSelectors(bad), ["#bgShift", ".glow"]);

  // Compound selectors and variable targets are skipped, not flagged.
  const tricky =
    '<div id="a">x</div>' +
    '<script>gsap.to("#a .b",{x:1});gsap.to(el,{x:1});gsap.to(".c, .d",{x:1});</script>';
  assert.deepEqual(findDanglingSelectors(tricky), []);

  assert.deepEqual(findDanglingSelectors(""), []);
  assert.deepEqual(findDanglingSelectors(null), []);
});

test("meanAbsDiff measures pixel change 0..1", () => {
  const a = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  const b = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(meanAbsDiff(a, b), 0);
  const c = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
  assert.ok(meanAbsDiff(a, c) > 0.4 && meanAbsDiff(a, c) <= 1);
});

test("closeVoidElements self-closes void tags for XML parsing", () => {
  assert.equal(closeVoidElements('<img src="a.png">'), '<img src="a.png"/>');
  assert.equal(closeVoidElements('<br>'), '<br/>');
  assert.equal(closeVoidElements('<div>x</div>'), '<div>x</div>');
  assert.equal(closeVoidElements('<img src="a.png"/>'), '<img src="a.png"/>');
});

test("containsAuthored finds authored ops incl. blends", () => {
  assert.equal(containsAuthored([{ op: "background" }]), false);
  assert.equal(containsAuthored([{ op: "authored", doc_id: "d1" }]), true);
  assert.equal(
    containsAuthored([{ op: "blend", under: [{ op: "text" }], over: [{ op: "authored", doc_id: "d" }] }]),
    true,
  );
});

test("expandAuthoredOps swaps authored for raster images", async () => {
  const images = new Map();
  const seen = [];
  const ops = [
    { op: "background", color: "#000" },
    { op: "authored", doc_id: "doc/1" },
    { op: "blend", mode: "fade", mix: 0.5, under: [{ op: "authored", doc_id: "doc/2" }], over: [{ op: "text" }] },
  ];
  const out = await expandAuthoredOps(ops, {
    getDoc: async (id) => `<div>${id}</div>`,
    render: async ({ docId, progress }) => {
      seen.push([docId, progress]);
      return { bitmap: docId };
    },
    images,
    width: 608,
    height: 1080,
    progress: 0.25,
  });
  assert.equal(out[0].op, "background");
  assert.deepEqual(out[1], { op: "image", ref: "authored:doc/1", zoom: 1, alpha: 1 });
  assert.deepEqual(out[2].under, [{ op: "image", ref: "authored:doc/2", zoom: 1, alpha: 1 }]);
  assert.deepEqual(out[2].over, [{ op: "text" }]);
  assert.deepEqual(images.get("authored:doc/1"), { bitmap: "doc/1" });
  assert.deepEqual(seen, [["doc/1", 0.25], ["doc/2", 0.25]]);

  const noId = await expandAuthoredOps([{ op: "authored", doc_id: "" }], {
    getDoc: async () => "<div/>",
    render: async () => ({}),
    images: new Map(),
  }).then(
    () => null,
    (error) => error,
  );
  assert.equal(noId && noId.code, "authored_missing");
  const gone = await expandAuthoredOps([{ op: "authored", doc_id: "missing" }], {
    getDoc: async () => null,
    render: async () => ({}),
    images: new Map(),
  }).then(
    () => null,
    (error) => error,
  );
  assert.equal(gone && gone.code, "authored_missing");
});
