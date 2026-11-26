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
    await page.waitForSelector(".stats .big, .card.step.has-error", { timeout: 60_000 });
    return page.evaluate(() => ({
      estimate: document.querySelector(".stats .big")?.textContent ?? null,
      error: document.querySelector(".card.step.has-error .error")?.textContent ?? null,
    }));
  };

  await page.goto(APP_URL);
  const d0 = await readout();
  check(d0.estimate && !d0.error, `default recipe: estimate shows (${d0.estimate})`);
  await page.reload();
  const d1 = await readout();
  check(d1.estimate && !d1.error, `default recipe after a reload: estimate shows (${d1.estimate})`);

  await page.selectOption("aside.side select.add-step >> nth=-1", "levels");
  await page.waitForSelector('.strip .box[data-key="levels"]');
  const keys = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key));
  check(keys.join(",") === "source,threshold,levels,centerline,order", `recipe is Threshold → Levels → Centerline → Stroke order (${keys.join(", ")})`);
  await page.waitForSelector(".card.step.has-error", { timeout: 60_000 });
  const before = await readout();
  check(!!before.error, `with Levels, Centerline reports an error ("${before.error}")`);
  check(before.estimate === null, `no estimate is shown for a recipe that fails (shown: ${before.estimate})`);

  // Let the autosave land, then reload.
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.strip .box[data-key="levels"]', { timeout: 30_000 });
  const after = await readout();
  check(after.error === before.error && after.estimate === before.estimate, `the readout is the same after a reload (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
