/**
 * Authored HyperFrames scene runtime.
 *
 * Executes model-authored HTML+GSAP scene docs offscreen and rasterizes them
 * to bitmaps at the render clock, so `authored` ops paint real motion graphics
 * instead of failing with `authored_not_supported`.
 *
 * How it works:
 * - Each scene doc is a full HTML document (as authored by the model). It is
 *   staged in a hidden same-origin `srcdoc` iframe sized exactly to the render
 *   dims, so viewport units (vw/vh) resolve correctly.
 * - External `<script src>` is NEVER staged: the vendored gsap module drives
 *   the doc's inline scripts from the parent realm, with the iframe document
 *   scoped in. Created timelines/tweens are captured, paused, and seeked by
 *   fraction of their total duration -> deterministic frames.
 * - Frames are captured by serializing the live (seeked) DOM into an
 *   SVG foreignObject image and drawing it onto the segment canvas.
 *
 * Trust note: staged markup is static (scripts stripped); inline scripts run
 * in the page realm with network-capable globals. Sources are our own model
 * outputs in a local single-user app. Prompts forbid fetch/random/Date; a
 * future hardening step is CSP + a locked-down script scope.
 *
 * Limits (phase 1): webfonts inside the raster fall back (font files cannot
 * load in the SVG-image context); external <img> is inlined best-effort;
 * per-frame cost is one serialize+raster (~10-50ms).
 */

import { gsap } from "gsap";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withTimeout(promise, ms, code) {
  let timer = 0;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(codedError(code, `timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Split a full authored HTML doc into styles / inline scripts / body HTML.
 * Pure (no DOM): safe to unit-test in Node.
 */
export function splitAuthoredDoc(html) {
  const src = String(html || "");
  const styles = [];
  const inlineScripts = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;
  while ((match = styleRe.exec(src))) styles.push(match[1]);
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  while ((match = scriptRe.exec(src))) {
    if (/\bsrc\s*=/.test(match[1])) continue; // external (CDN gsap): vendored instead
    if (match[2].trim()) inlineScripts.push(match[2]);
  }
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  let body = bodyMatch ? bodyMatch[1] : src;
  // Scripts run via runAuthoredScripts, styles are hoisted: the staged
  // markup stays inert content only.
  body = body
    .replace(/<script[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<link[^>]*>/gi, "");
  if (!bodyMatch) {
    body = body.replace(/<head[^>]*>[\s\S]*?<\/head\s*>/gi, "");
  }
  const stylesheets = [];
  const linkRe = /<link([^>]*)>/gi;
  while ((match = linkRe.exec(src))) {
    const attrs = match[1];
    if (/rel\s*=\s*["']stylesheet["']/.test(attrs)) {
      const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      if (href) stylesheets.push(href[1]);
    }
  }
  return { styles, inlineScripts, body, stylesheets };
}

/**
 * Wrap a gsap instance to record created timelines/tweens. Pure (no DOM):
 * pass any gsap-shaped object, including fakes in tests.
 */
export function captureTimelines(gsapImpl) {
  const created = { timelines: [], tweens: [] };
  const proxy = new Proxy(gsapImpl, {
    get(target, prop) {
      if (prop === "timeline") {
        return (...args) => {
          const tl = target.timeline(...args);
          if (tl) created.timelines.push(tl);
          return tl;
        };
      }
      if (prop === "to" || prop === "from" || prop === "fromTo" || prop === "set") {
        return (targets, ...args) => {
          const tween = target[prop](targets, ...args);
          if (tween && typeof tween.pause === "function") created.tweens.push(tween);
          return tween;
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { proxy, created };
}

/** Total animation time covered by captured timelines/tweens. Pure. */
export function capturedDuration(created) {
  let total = 0;
  for (const tl of created.timelines || []) {
    try {
      total = Math.max(total, tl.duration() || 0);
    } catch {
      // A fake or dead timeline must not break the render.
    }
  }
  for (const tween of created.tweens || []) {
    try {
      const dur = typeof tween.totalDuration === "function" ? tween.totalDuration() : tween.duration();
      const delay = typeof tween.delay === "function" ? tween.delay() : 0;
      total = Math.max(total, (delay || 0) + (dur || 0));
    } catch {
      // Ignore unloadable tweens; timelines carry the scene.
    }
  }
  return total;
}

/**
 * Seek everything to absolute time t (seconds). suppressEvents=false so
 * counter onUpdate callbacks rewrite their text at the seeked position.
 * Pure logic over injected objects.
 */
export function seekAtTime(created, t) {
  const time = Math.max(0, t);
  for (const tl of created.timelines || []) {
    try {
      tl.pause();
      tl.seek(Math.min(time, tl.duration()), false);
    } catch {
      // A failed seek leaves the previous frame; never blank the render.
    }
  }
  for (const tween of created.tweens || []) {
    try {
      tween.pause();
      const delay = typeof tween.delay === "function" ? tween.delay() : 0;
      const dur = typeof tween.totalDuration === "function" ? tween.totalDuration() : 1;
      const local = Math.min(1, Math.max(0, (time - (delay || 0)) / Math.max(1e-6, dur || 1)));
      if (typeof tween.totalProgress === "function") tween.totalProgress(local, false);
      else if (typeof tween.progress === "function") tween.progress(local, false);
    } catch {
      // Ignore; the master timeline carries the scene.
    }
  }
}

/**
 * Seek everything to fraction p (0..1) of total. See seekAtTime.
 * Pure logic over injected objects.
 */
export function seekCaptured(created, total, p) {
  seekAtTime(created, Math.min(1, Math.max(0, p)) * Math.max(0, total));
}

/** Release captured animations from the gsap ticker. */
export function killCaptured(created) {
  for (const tl of created?.timelines || []) {
    try {
      tl.kill();
    } catch {
      // Already dead; nothing to release.
    }
  }
  for (const tween of created?.tweens || []) {
    try {
      tween.kill();
    } catch {
      // Already dead; nothing to release.
    }
  }
}

/**
 * Run authored inline scripts with vendored gsap + the staged document.
 * Scripts observe `gsap`, `document` (staged) and a minimal `window` shim.
 * Async: `load` listeners fire on a microtask (the staged DOM is already
 * parsed when scripts run, so deferring init to `load` is honored instead
 * of silently dropping it — otherwise docs that init on load would stage
 * with zero timelines and render dead).
 */
export async function runAuthoredScripts(scripts, { gsapImpl = gsap, stagedDocument, width, height } = {}) {
  if (!stagedDocument) throw codedError("authored_stage", "authored scripts need a staged document");
  const { proxy, created } = captureTimelines(gsapImpl);
  const pendingLoad = [];
  const scopeWindow = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    // The staged document is fully parsed before scripts run, so `load`
    // handlers execute on the next microtask and their timelines are still
    // captured. Other event types stay no-ops: the runner seeks the captured
    // timeline deterministically instead of playing it live.
    addEventListener: (type, listener) => {
      if ((type === "load" || type === "DOMContentLoaded") && typeof listener === "function") {
        pendingLoad.push(listener);
      }
    },
    removeEventListener: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  for (const code of scripts) {
    let fn;
    try {
      fn = new Function("gsap", "document", "window", `"use strict";\n${code}`);
    } catch (error) {
      throw codedError("authored_exec", `authored script does not parse: ${(error && error.message) || error}`);
    }
    try {
      fn(proxy, stagedDocument, scopeWindow);
    } catch (error) {
      throw codedError("authored_exec", `authored script failed: ${(error && error.message) || error}`);
    }
  }
  for (const listener of pendingLoad.splice(0)) {
    try {
      await listener();
    } catch (error) {
      throw codedError("authored_exec", `authored load handler failed: ${(error && error.message) || error}`);
    }
  }
  // Let any remaining microtasks from init code settle before capturing.
  await Promise.resolve();
  if (created.timelines.length === 0 && created.tweens.length === 0) {
    // Last resort for init-on-DOMContentLoaded docs: both the real
    // DOMContentLoaded and the iframe load already fired before inline
    // scripts ran, so listeners on them would never execute and the scene
    // would stage dead. Replaying the events only when nothing was
    // captured avoids double-initializing docs that already set up.
    try {
      if (typeof stagedDocument.dispatchEvent === "function") {
        stagedDocument.dispatchEvent(new Event("DOMContentLoaded"));
        stagedDocument.dispatchEvent(new Event("load"));
      }
    } catch {
      // Non-Document stage (unit tests): nothing to replay.
    }
    if (typeof scopeWindow.onload === "function") {
      try {
        await scopeWindow.onload();
      } catch (error) {
        throw codedError("authored_exec", `authored onload handler failed: ${(error && error.message) || error}`);
      }
    }
    await Promise.resolve();
  }
  return created;
}

/** Self-close void elements so the serialization parses as XML. Pure. */
export function closeVoidElements(markup) {
  return String(markup || "").replace(
    /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^<>]*?)?>/gi,
    (full, tag, attrs = "") => (full.endsWith("/>") ? full : `<${tag.toLowerCase()}${attrs}/>`),
  );
}

/**
 * Count explicit entrance tweens in an authored doc. Pure (no DOM): a doc
 * whose layout is fully visible at time 0 has no entrances — typically zero
 * `.from()`/`.fromTo()` calls and no initially-hidden elements.
 */
export function countEntranceTweens(html) {
  const parts = splitAuthoredDoc(html);
  const js = parts.inlineScripts.join("\n");
  const froms = (js.match(/\.(from|fromTo)\s*\(/g) || []).length;
  const css = parts.styles.join("\n");
  const hiddenInit =
    /opacity\s*:\s*0/.test(css) || /style\s*=\s*"[^"]*opacity\s*:\s*0/.test(parts.body);
  return { froms, hiddenInit };
}

/**
 * True when the doc plausibly builds up from a nearly empty frame: at least
 * two explicit entrance tweens, or one plus initially-hidden elements that a
 * timeline reveals. Pure.
 */
export function hasStaggeredEntrances(html, minFroms = 2) {
  try {
    const { froms, hiddenInit } = countEntranceTweens(html);
    return froms >= minFroms || (froms >= 1 && hiddenInit);
  } catch {
    return false;
  }
}

/**
 * Ids and class names present in the staged body markup. Pure.
 */
export function collectDocHooks(html) {
  const { body } = splitAuthoredDoc(html);
  const ids = new Set();
  const classes = new Set();
  const idRe = /\bid\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = idRe.exec(body))) ids.add(match[1]);
  const classRe = /\bclass\s*=\s*"([^"]+)"/gi;
  while ((match = classRe.exec(body))) {
    for (const cls of match[1].split(/\s+/)) if (cls) classes.add(cls);
  }
  return { ids, classes };
}

/**
 * Unambiguous literal targets animated or queried in inline scripts:
 * whole-target `#id` / `.class` in gsap.to/from/fromTo/set and
 * querySelector(All)/getElementById calls. Compound selectors
 * (`"#a .b"`, `"div > .c"`) and variable targets are skipped — too dynamic
 * to verify statically. Pure.
 */
export function collectTweenSelectors(html) {
  const { inlineScripts } = splitAuthoredDoc(html);
  const js = inlineScripts.join("\n");
  const found = new Set();
  const callRe = /\.(?:to|from|fromTo|set)\s*\(\s*|(?:querySelector(?:All)?|getElementById)\s*\(\s*/g;
  const strRe = /\s*("([^"]+)"|'([^']+)')/y;
  let call;
  while ((call = callRe.exec(js))) {
    strRe.lastIndex = callRe.lastIndex;
    const str = strRe.exec(js);
    if (!str) continue;
    callRe.lastIndex = strRe.lastIndex;
    const sel = str[2] ?? str[3];
    if (/^#[A-Za-z][\w-]*$/.test(sel) || /^\.[A-Za-z][\w-]*$/.test(sel)) {
      found.add(sel);
    } else if (/^[A-Za-z][\w-]*$/.test(sel)) {
      // getElementById("stage") — bare id without #.
      found.add(`#${sel}`);
    }
    // Anything else (compound, lists, variables) is skipped.
  }
  return [...found];
}

/**
 * Animated selectors matching no element in the doc. A tween on a missing
 * target is a silent no-op — typically leaving its element hidden forever,
 * which renders as background-only video. Pure.
 */
export function findDanglingSelectors(html) {
  try {
    const { ids, classes } = collectDocHooks(html);
    return collectTweenSelectors(html).filter((sel) =>
      sel.startsWith("#") ? !ids.has(sel.slice(1)) : !classes.has(sel.slice(1)),
    );
  } catch {
    return [];
  }
}

/** Mean per-channel pixel difference 0..1 between two ImageData buffers. Pure. */
export function meanAbsDiff(pa, pb) {
  const n = Math.min(pa.length, pb.length);
  let sum = 0;
  for (let i = 0; i < n; i += 4 * 37) {
    sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
  }
  const count = Math.ceil(n / (4 * 37)) || 1;
  return sum / (count * 3 * 255);
}

/**
 * Minimum change across consecutive sample points. A scene that builds up
 * keeps every window alive; one that back-loads everything scores ~0 early.
 * Pure over an array of diffs.
 */
export function minConsecutiveSpread(diffs) {
  if (!Array.isArray(diffs) || diffs.length === 0) return 0;
  return Math.min(...diffs.map((d) => Number(d) || 0));
}

/** True when an ops tree contains an `authored` op (incl. blend layers). Pure. */
export function containsAuthored(ops) {
  for (const op of ops || []) {
    if (!op) continue;
    if (op.op === "authored") return true;
    if (op.op === "blend") {
      if (containsAuthored(op.under) || containsAuthored(op.over)) return true;
    }
  }
  return false;
}

/**
 * Replace `authored` ops with rasterized `image` ops, registering bitmaps in
 * the frame `images` map. Pure orchestration: DOM/raster work is injected via
 * getDoc/render, so this is unit-testable with fakes.
 */
export async function expandAuthoredOps(ops, { getDoc, render, images, width, height, progress, bg }) {
  const out = [];
  for (const op of ops || []) {
    if (op && op.op === "authored") {
      const docId = op.doc_id;
      if (!docId) throw codedError("authored_missing", "authored visual has no doc_id");
      const html = await getDoc(docId);
      if (typeof html !== "string" || !html) {
        throw codedError("authored_missing", `authored doc not found: ${docId}`);
      }
      const bitmap = await render({ docId, html, progress, width, height, bg });
      const key = `authored:${docId}`;
      images.set(key, bitmap);
      out.push({ op: "image", ref: key, zoom: 1, alpha: 1 });
    } else if (op && op.op === "blend") {
      out.push({
        ...op,
        under: await expandAuthoredOps(op.under, { getDoc, render, images, width, height, progress, bg }),
        over: await expandAuthoredOps(op.over, { getDoc, render, images, width, height, progress, bg }),
      });
    } else {
      out.push(op);
    }
  }
  return out;
}

/** Page-level guard so staged docs fill the exact frame (pure, tested). */
export function guardCss(width, height, bg) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const color = typeof bg === "string" && bg ? bg : "#060511";
  return (
    `html,body{width:${w}px!important;height:${h}px!important;` +
    `margin:0!important;padding:0!important;overflow:hidden!important;background:${color}!important}`
  );
}

/**
 * Offscreen stage: one hidden srcdoc iframe per render size. Scripts are
 * stripped from staged markup (they run via runAuthoredScripts instead), so
 * the frame is inert content only.
 */
const FONT_FILES = ["/fonts/figtree-latin.woff2", "/fonts/figtree-latin-ext.woff2"];
let embeddedFontCSS = null;

/**
 * Brand fonts as data URLs for the raster context: font files cannot load
 * as external subresources inside an SVG image, so they are embedded.
 * Cached; failure falls back to system fonts (never blocks the render).
 */
export async function getEmbeddedFontCSS(fetchImpl) {
  if (!embeddedFontCSS) {
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    embeddedFontCSS = (async () => {
      const blocks = [];
      for (const path of FONT_FILES) {
        try {
          const res = await doFetch(path);
          if (!res.ok) continue;
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("unreadable"));
            reader.readAsDataURL(blob);
          });
          blocks.push(
            `@font-face{font-family:'Figtree';font-style:normal;font-weight:300 900;font-display:swap;src:url('${dataUrl}') format('woff2');}`,
          );
          if (blocks.length === 1) break; // latin covers the render; ext is bonus
        } catch {
          // Offline or missing: system fallback inside the raster.
        }
      }
      return blocks.join("\n");
    })();
  }
  return embeddedFontCSS;
}
export function createAuthoredStage({ ownerDocument, gsapImpl = gsap, ImageImpl, fetchImpl } = {}) {
  const D = ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!D) throw codedError("no_dom", "authored stage needs a document");
  const Img = ImageImpl || (typeof Image !== "undefined" ? Image : null);
  if (!Img) throw codedError("no_dom", "authored stage needs an Image constructor");
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let frame = null;
  let frameW = 0;
  let frameH = 0;
  let current = null; // { docId, created, total, staticBitmap }

  function disposeFrame() {
    if (frame) {
      try {
        frame.remove();
      } catch {
        // Already detached.
      }
    }
    frame = null;
    current = null;
  }

  function ensureFrame(w, h) {
    if (frame && frameW === w && frameH === h && frame.isConnected) return frame;
    disposeFrame();
    frame = D.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = `position:fixed;left:-12000px;top:0;width:${w}px;height:${h}px;border:0;visibility:hidden;`;
    D.body.appendChild(frame);
    frameW = w;
    frameH = h;
    return frame;
  }

  function waitLoad(target, ms = 4000) {
    return withTimeout(
      new Promise((resolve, reject) => {
        target.addEventListener("load", () => resolve(), { once: true });
      }),
      ms,
      "authored_load",
    );
  }

  async function inlineImages(fdoc) {
    const imgs = [...fdoc.images];
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute("src") || "";
        if (!src || src.startsWith("data:")) return;
        try {
          const res = await withTimeout(doFetch(src), 1500, "authored_asset");
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("unreadable"));
            reader.readAsDataURL(blob);
          });
          img.src = dataUrl;
        } catch {
          // External asset unreachable: keep going with the styled layout.
        }
      }),
    );
  }

  async function inlineStylesheets(parts) {
    const blocks = [];
    await Promise.all(
      parts.stylesheets.map(async (href) => {
        try {
          const res = await withTimeout(doFetch(href), 1500, "authored_asset");
          const css = await res.text();
          if (css.trim()) blocks.push(`/* inlined: ${href} */\n${css}`);
        } catch {
          // Offline or blocked: the doc's own <style> still applies.
        }
      }),
    );
    return blocks;
  }

  async function loadDoc(docId, html, w, h, bg) {
    const bgKey = typeof bg === "string" && bg ? bg : "#060511";
    // The html participates in the key: scoring a retry under the same docId
    // must stage the new markup, not return the previous attempt.
    if (current && current.docId === docId && current.html === html && frameW === w && frameH === h && current.bg === bgKey) return current;
    disposeFrame();
    const parts = splitAuthoredDoc(html);
    const inlined = await inlineStylesheets(parts);
    const fonts = await getEmbeddedFontCSS(doFetch);
    const host = ensureFrame(w, h);
    const srcdoc = `<!DOCTYPE html><html><head><style>${guardCss(w, h, bg)}</style>${fonts ? `<style>${fonts}</style>` : ""}${parts.styles.map((css) => `<style>${css}</style>`).join("")}${inlined.map((css) => `<style>${css}</style>`).join("")}</head><body>${parts.body}</body></html>`;
    const loaded = waitLoad(host);
    host.srcdoc = srcdoc;
    await loaded;
    const fdoc = host.contentDocument;
    if (!fdoc) throw codedError("authored_load", "staged frame has no document");
    await inlineImages(fdoc);
    try {
      await Promise.race([fdoc.fonts ? fdoc.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 900))]);
    } catch {
      // Fonts are progressive enhancement inside the raster.
    }
    const created = await runAuthoredScripts(parts.inlineScripts, { gsapImpl, stagedDocument: fdoc, width: w, height: h });
    const total = capturedDuration(created);
    // Freeze autoplay at t=0 so the first seek starts from a known state.
    seekCaptured(created, total, 0);
    current = { docId, html, created, total, staticBitmap: null, bg: bgKey };
    return current;
  }

  async function rasterize(fdoc, w, h) {
    const serializer = new XMLSerializer();
    let xhtml = serializer.serializeToString(fdoc);
    // The serializer keeps the doctype, but a DOCTYPE nested inside
    // foreignObject is malformed XML (it is only legal in the prolog).
    xhtml = xhtml.replace(/<!DOCTYPE[^>]*>/gi, "");
    // XMLSerializer normally declares the XHTML namespace itself; only add
    // it when missing, since a duplicate attribute breaks XML parsing.
    if (!/<html[^>]*xmlns/i.test(xhtml)) {
      xhtml = xhtml.replace(/<html(?=[\s>])/i, '<html xmlns="http://www.w3.org/1999/xhtml"');
    }
    // Model CSS may contain raw `&` (nesting) or `<`, which are fatal inside
    // an XML document. <style> bodies carry no markup, so CDATA is safe.
    xhtml = xhtml.replace(/<style([^>]*)>([\s\S]*?)<\/style\s*>/gi, (full, attrs, css) => {
      if (css.includes("<![CDATA[")) return full;
      return `<style${attrs}><![CDATA[${css}]]></style>`;
    });
    xhtml = closeVoidElements(xhtml);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
    // Fail fast with the parser's own verdict instead of a generic decode error.
    const probe = new DOMParser().parseFromString(svg, "image/svg+xml");
    const parseError = probe.querySelector("parsererror");
    if (parseError) {
      const text = (parseError.textContent || "").trim().slice(0, 200);
      const col = Number((text.match(/column (\d+)/) || [])[1]);
      const context = Number.isFinite(col) ? svg.slice(Math.max(0, col - 140), col + 80) : svg.slice(0, 200);
      throw codedError("authored_raster", `staged scene is not well-formed XML: ${text} :: ${context}`);
    }
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const bmp = new Img();
    bmp.src = url;
    if (typeof bmp.decode === "function") {
      await bmp.decode();
    } else {
      await new Promise((resolve, reject) => {
        bmp.onload = () => resolve();
        bmp.onerror = () => reject(codedError("authored_raster", "authored frame did not decode"));
      });
    }
    return bmp;
  }

  return {
    async render({ docId, html, progress = 0, width, height, sceneSecs = 0, bg }) {
      const state = await loadDoc(docId, html, width, height, bg);
      if (!(state.total > 0)) {
        // Static doc: rasterize once and reuse for every frame.
        if (!state.staticBitmap) {
          const fdoc = frame.contentDocument;
          state.staticBitmap = await rasterize(fdoc, width, height);
        }
        return state.staticBitmap;
      }
      const p = Math.min(1, Math.max(0, progress));
      const secs = Number(sceneSecs) || 0;
      if (secs > 0 && Math.abs(state.total - secs) / secs <= 0.25) {
        // The timeline matches the scene length: seek exact seconds.
        seekAtTime(state.created, p * secs);
      } else {
        // Otherwise stretch the timeline across the scene: motion always
        // fills the time instead of freezing after an early finish.
        seekCaptured(state.created, state.total, p);
      }
      const fdoc = frame.contentDocument;
      try {
        await Promise.race([
          Promise.all([...fdoc.images].map((img) => (img.decode ? img.decode().catch(() => {}) : null))),
          new Promise((r) => setTimeout(r, 600)),
        ]);
      } catch {
        // Images are best-effort; layout and motion still rasterize.
      }
      const bitmap = await rasterize(fdoc, width, height);
      return bitmap;
    },
    /**
     * Motion score 0..1 for a doc: max mean pixel difference across three
     * sample points. Near zero means the scene would play static. Used to
     * retry authoring once with stronger motion language.
     */
    async motionScore({ docId, html, width, height }) {
      const state = await loadDoc(docId, html, width, height);
      if (!(state.total > 0)) return 0;
      const samples = [];
      for (const p of [0.2, 0.5, 0.8]) {
        seekCaptured(state.created, state.total, p);
        samples.push(await rasterize(frame.contentDocument, width, height));
      }
      const probe = D.createElement("canvas");
      probe.width = width;
      probe.height = height;
      const ctx = probe.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 1; // Cannot measure: assume motion rather than retry.
      const pixels = samples.map((bmp) => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bmp, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      });
      let best = 0;
      for (let a = 0; a < pixels.length; a++) {
        for (let b = a + 1; b < pixels.length; b++) {
          best = Math.max(best, meanAbsDiff(pixels[a], pixels[b]));
        }
      }
      return best;
    },
    /**
     * Spread score: how the first half builds. Returns { minWindow, build }:
     * minWindow is the smallest change across consecutive early windows
     * (0.05→0.25→0.5); build is the change from the empty start to the
     * halfway frame. Catches both failure modes at once: a full layout
     * sitting static from time 0, and an opening kept empty with everything
     * back-loaded. Calibrated against a real dawdling video (build ≈ 0.006)
     * vs a dense build (≈ 0.15+).
     */
    async spreadScore({ docId, html, width, height }) {
      const state = await loadDoc(docId, html, width, height);
      if (!(state.total > 0)) return { minWindow: 0, build: 0 };
      const points = [0, 0.25, 0.5];
      const frames = [];
      for (const p of points) {
        seekCaptured(state.created, state.total, p);
        frames.push(await rasterize(frame.contentDocument, width, height));
      }
      const probe = D.createElement("canvas");
      probe.width = width;
      probe.height = height;
      const ctx = probe.getContext("2d", { willReadFrequently: true });
      if (!ctx) return { minWindow: 1, build: 1 }; // Cannot measure: assume motion rather than retry.
      const pixels = frames.map((bmp) => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bmp, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      });
      const diffs = [];
      for (let i = 1; i < pixels.length; i++) {
        diffs.push(meanAbsDiff(pixels[i - 1], pixels[i]));
      }
      return {
        minWindow: minConsecutiveSpread(diffs),
        build: meanAbsDiff(pixels[0], pixels[pixels.length - 1]),
      };
    },
    dispose() {
      if (current) killCaptured(current.created);
      disposeFrame();
    },
  };
}

/** Score below which a doc counts as static (heuristic, see motionScore). */
export const MOTION_SCORE_THRESHOLD = 0.008;

/**
 * Minimum change required in every first-half window (see spreadScore).
 * Lower than the motion threshold: consecutive windows sit closer together,
 * so the same visible entrance scores smaller — but still far above noise.
 */
export const SPREAD_SCORE_THRESHOLD = 0.004;

/**
 * Minimum change from the empty start to the halfway frame. Calibrated:
 * a dawdling video measured 0.006, a dense build scores 0.15+.
 */
export const BUILD_SCORE_THRESHOLD = 0.03;

let sharedStage = null;
/** Process-wide stage so authoring checks and frame rendering share one iframe. */
export function getSharedStage(deps = {}) {
  if (!sharedStage) sharedStage = createAuthoredStage(deps);
  return sharedStage;
}

/**
 * Lazy motion scorer for adapters: construction touches no DOM, so browser
 * adapter sets stay constructible in Node; scoring throws no_dom there and
 * runMotionJob skips the retry path.
 */
export function createAuthoredScorer({ getStage = getSharedStage } = {}) {
  return {
    score(args) {
      return getStage().motionScore(args);
    },
    spreadScore(args) {
      return getStage().spreadScore(args);
    },
  };
}
