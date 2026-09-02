import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:3100/#editor", { waitUntil: "networkidle0" });
await page.waitForSelector(".editor-main h1");
await new Promise((r) => setTimeout(r, 1000));

const SIX = "0 0 250px #23223A,0 0 250px #23223A,0 0 250px #23223A,0 0 250px #23223A,0 0 142.8px #23223A,0 0 71.4px #23223A";
const TWO = "0 0 250px #23223A,0 0 71.4px #23223A";

const clip = await page.evaluate(() => {
  const r = document.querySelector(".editor-main h1").getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(r.left - 270)),
    y: Math.max(0, Math.round(r.top - 270)),
    width: Math.round(r.width + 540),
    height: Math.round(r.height + 540),
  };
});

await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, SIX);
await new Promise((r) => setTimeout(r, 800));
writeFileSync("/tmp/h1six-clip.png", await page.screenshot({ clip }));

await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, TWO);
await new Promise((r) => setTimeout(r, 800));
writeFileSync("/tmp/h1two-clip.png", await page.screenshot({ clip }));

async function framesDuring() {
  await page.evaluate(() => { document.querySelectorAll(".editor-mode-pill button")[0].click(); });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    window.__f = [];
    const t0 = performance.now();
    const loop = (t) => { window.__f.push(t - t0); if (t - t0 < 500) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.evaluate(() => { document.querySelectorAll(".editor-mode-pill button")[2].click(); });
  await new Promise((r) => setTimeout(r, 700));
  const f = await page.evaluate(() => window.__f);
  const gaps = [];
  for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
  gaps.sort((a, b) => a - b);
  return { frames: f.length, maxGapMs: Math.round(Math.max(...gaps)), gapsOver33: gaps.filter((g) => g > 33).length };
}

await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, SIX);
await new Promise((r) => setTimeout(r, 300));
const p6 = await framesDuring();
await page.evaluate((s) => { document.querySelector(".editor-main h1").style.textShadow = s; }, TWO);
await new Promise((r) => setTimeout(r, 300));
const p2 = await framesDuring();

console.log("clip h1:", JSON.stringify(clip));
console.log("PERF 6 sombras:", JSON.stringify(p6));
console.log("PERF 2 sombras:", JSON.stringify(p2));
await browser.close();