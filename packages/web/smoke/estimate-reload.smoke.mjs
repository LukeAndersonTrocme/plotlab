// Bug #85: Threshold → Levels → Centerline → Stroke order shows a time estimate before a
// reload but none after. The recipe can't run (Levels makes categories; Centerline traces
// tone only), so the estimate before the reload was left over from the previous recipe.
// The readout must be the same either side of a reload: an error, and no estimate.
// Run after a build:
//   BASE=/plotlab/ pnpm exec vite build && PORT=5299 node smoke/estimate-reload.smoke.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 5199);
const BASE = process.env.BASE ?? "/plotlab/";
const APP_URL = `http://localhost:${PORT}${BASE}`;
const root = fileURLToPath(new URL("..", import.meta.url));

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe", env: { ...process.env, BASE } });
const ready = new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve());
  server.on("exit", (c) => reject(new Error(`vite preview exited (${c})`)));
});

let browser;
try {
  await ready;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  /** The readout once the run has settled: the estimate (if any) and the step error (if any). */
  const readout = async () => {
    await page.waitForSelector(".stats .big, .failed-note", { timeout: 60_000 });
    return page.evaluate(() => ({
      estimate: document.querySelector(".stats .big")?.textContent ?? null,
      error: document.querySelector(".failed-note")?.textContent ?? null,
    }));
  };

  await page.goto(APP_URL);
  const d0 = await readout();
  check(d0.estimate && !d0.error, `default recipe: estimate shows (${d0.estimate})`);
  await page.reload();
  const d1 = await readout();
  check(d1.estimate && !d1.error, `default recipe after a reload: estimate shows (${d1.estimate})`);

  // Build the invalid recipe through the strip: "+" after Threshold, then Levels.
  await page.click('.strip .gap[data-gap="1"] .plus');
  await page.click('.add-menu [role=menuitem][data-step="levels"]');
  await page.waitForSelector('.strip .box[data-key="levels"]');
  const keys = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key));
  check(keys.join(",") === "source,threshold,levels,centerline,order", `recipe is Threshold → Levels → Centerline → Stroke order (${keys.join(", ")})`);
  await page.waitForSelector(".failed-note", { timeout: 60_000 });
  const before = await readout();
  check(!!before.error, `with Levels, Centerline reports an error ("${before.error}")`);
  check(before.estimate === null, `no estimate is shown for a recipe that fails (shown: ${before.estimate})`);

  // The canvas keeps the last good plot, dimmed, with the error over it in plain words.
  const cue = await page.evaluate(() => ({
    dimmed: !!document.querySelector(".canvas-frame.failed svg.preview"),
    opacity: Number(getComputedStyle(document.querySelector(".canvas-frame.failed svg.preview") ?? document.body).opacity),
    note: document.querySelector(".canvas-frame .failed-note")?.textContent ?? null,
    strokes: /strokes/.test(document.querySelector(".stats")?.textContent ?? ""),
  }));
  check(cue.dimmed && cue.opacity < 1, `the last good plot stays on the canvas, dimmed (opacity ${cue.opacity})`);
  check(/This recipe can't run/.test(cue.note ?? "") && /Centerline traces tone layers/.test(cue.note ?? ""), `the canvas says why, in plain words ("${cue.note}")`);
  check(!cue.strokes, "the stroke count is not shown as if current");

  // Let the autosave land, then reload.
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.strip .box[data-key="levels"]', { timeout: 30_000 });
  const after = await readout();
  // After a reload there is no earlier plot, so only the lead-in of the message differs.
  const reason = (e) => (e ?? "").replace(/^This recipe can't run[^.]*\.\s*/, "");
  check(reason(after.error) === reason(before.error) && after.estimate === before.estimate, `the readout is the same after a reload (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`);

  // A later run that works clears the dim and the message.
  await page.click('button[aria-label="Remove Levels"]');
  await page.waitForSelector(".stats .big", { timeout: 60_000 });
  const ok = await page.evaluate(() => ({ failed: !!document.querySelector(".canvas-frame.failed"), note: !!document.querySelector(".failed-note") }));
  check(!ok.failed && !ok.note, "a later run that succeeds removes the dim and the message");
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
