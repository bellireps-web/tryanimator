import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:3100/#editor", { waitUntil: "networkidle0" });
await page.waitForSelector(".editor-main h1");
await new Promise((r) => setTimeout(r, 900));

const SIX = "0 0 250px #23223A,0 0 250px #23223A,0 0 250px #23223A,0 0 250px #23223A,0 0 142.8px #23223A,0 0 71.4px #23223A";
const TWO = "0 0 250px #23223A,0 0 71.4px #23223A";

async function captureH1() {
  return await page.evaluate(() => {
    const h1 = document.querySelector(".editor-main h1");
    const r = h1.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.left - 270));
    const y = Math.max(0, Math.round(r.top - 270));
    const w = Math.round(r.width + 540);
    const h = Math.round(r.height + 540);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawWindow ? ctx.drawWindow(window, x, y, w, h, "rgb(6,5,17)") : null;
    // fallback: html2canvas is not available; use document.elementFromPoint sampling instead
    const pts = [];
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const px = x + Math.floor((w * i) / 40);
        const py = y + Math.floor((h * j) / 40);
        const el = document.elementFromPoint(px, py);
        if (el) {
          const s = getComputedStyle(el);
          pts.push(s.color + "|" + (el === h1 ? "h1" : el.tagName));
        }
      }
    }
    return { x, y, w, h, pts };
  });
}

// Visual diff via screenshot buffers (PNG) decoded roughly: just compare bytes via node canvas-free approach
async function shot() {
  return await page.screenshot({ type: "png" });
}

// --- VISUAL COMPARISON ---
await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, SIX);
await new Promise((r) => setTimeout(r, 700));
const shotSix = await shot();
await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, TWO);
await new Promise((r) => setTimeout(r, 700));
const shotTwo = await shot();
const { writeFileSync } = await import("fs");
writeFileSync("/tmp/h1-six.png", shotSix);
writeFileSync("/tmp/h1-two.png", shotTwo);
console.log("Screenshots guardados: /tmp/h1-six.png (6 sombras) y /tmp/h1-two.png (2 sombras)");

// --- RENDIMIENTO: frames durante Creator→Motion ---
async function framesDuring(dur) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll(".editor-mode-pill button");
    btns[0].click(); // Editor
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    window.__f = [];
    const t0 = performance.now();
    const loop = (t) => { window.__f.push(t - t0); if (t - t0 < dur) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.evaluate(() => { document.querySelectorAll(".editor-mode-pill button")[2].click(); }); // Motion
  await new Promise((r) => setTimeout(r, dur + 200));
  const f = await page.evaluate(() => window.__f);
  const gaps = [];
  for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
  gaps.sort((a, b) => a - b);
  return { frames: f.length, avgGapMs: Math.round(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)), maxGapMs: Math.round(Math.max(...gaps)) };
}

await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, SIX);
const perfSix = await framesDuring(600);
await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, TWO);
const perfTwo = await framesDuring(600);

console.log("PERF 6 sombras:", JSON.stringify(perfSix));
console.log("PERF 2 sombras:", JSON.stringify(perfTwo));
await browser.close();