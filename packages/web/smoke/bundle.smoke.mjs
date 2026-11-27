// Bundles (ADR 0014): export a project from the editor, then open the zip in a fresh browser
// (no projects stored) at phone width and see the project in the viewer's list.
// Run after a build:
//   BASE=/plotlab/ pnpm exec vite build && node smoke/bundle.smoke.mjs
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 5199);
const BASE = process.env.BASE ?? "/plotlab/";
const APP_URL = `http://localhost:${PORT}${BASE}`;
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "plotlab-bundle-"));

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

  // The editor: save a checkpoint, then export the project (with and without the image).
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await desk.newPage();
  await page.goto(APP_URL);
  await page.waitForSelector(".stats .big", { timeout: 60_000 });
  await page.click("header.top .cp-save");
  await page.click("header.top button:has-text('Checkpoints')");
  await page.waitForSelector(".ckpt-sidebar .ckpt", { timeout: 30_000 });
  const exportZip = async (file) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".ckpt-sidebar .bundle-btn:has-text('Export project')")]);
    const path = join(dir, file);
    await dl.saveAs(path);
    return { path, name: dl.suggestedFilename() };
  };
  const full = await exportZip("full.zip");
  check(/\.zip$/.test(full.name), `the editor exports the project as a zip (${full.name})`);
  await page.check(".ckpt-sidebar .bundle-leave input");
  const bare = await exportZip("bare.zip");
  await desk.close();

  // A fresh browser at phone width: the viewer shows the sample until a bundle is opened.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(APP_URL);
  await phone.waitForSelector(".phone-projects .phone-project", { timeout: 30_000 });
  const metaBefore = await phone.$$eval(".phone-project-meta", (els) => els.map((e) => e.textContent));
  check(metaBefore.join() === "0 checkpoints", `phone, nothing stored: the sample with no checkpoints (${metaBefore.join(", ")})`);

  // Without its image, for a project that isn't here: refused in plain words.
  await phone.setInputFiles(".phone-bundle input[type=file]", bare.path);
  await phone.waitForSelector(".phone .phone-error", { timeout: 30_000 });
  const refused = await phone.textContent(".phone .phone-error");
  check(refused.includes("leaves out its image"), `a bundle without its image is refused ("${refused}")`);

  await phone.setInputFiles(".phone-bundle input[type=file]", full.path);
  await phone.waitForSelector(".phone-opened", { timeout: 30_000 });
  const summary = await phone.textContent(".phone-opened");
  check(/^Opened .+: 1 checkpoint added\./.test(summary), `phone: opening the bundle says what was added ("${summary}")`);
  await phone.waitForFunction(() => [...document.querySelectorAll(".phone-project-meta")].some((e) => e.textContent === "1 checkpoint"), null, { timeout: 30_000 });
  const cards = await phone.$$eval(".phone-project", (els) => els.map((e) => e.textContent));
  check(cards.length === 1, `phone: the imported project is in the list without a reload (${cards.join(" | ")})`);
  check(!(await phone.textContent(".phone")).includes("here is the sample to look at"), "phone: the sample note is gone");
  await phone.click(".phone-project");
  await phone.waitForSelector(".phone-ckpt", { timeout: 30_000 });
  const ckpts = await phone.$$eval(".phone-ckpt", (els) => els.length);
  check(ckpts === 2, `phone: the project opens with its saved settings and its checkpoint (${ckpts} versions)`);
  await phoneCtx.close();

  // The editor in another fresh browser: Open a bundle merges it into the sample project here.
  const desk2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ed = await desk2.newPage();
  await ed.goto(APP_URL);
  await ed.waitForSelector(".stats .big", { timeout: 60_000 });
  await ed.click("header.top button:has-text('Checkpoints')");
  await ed.setInputFiles(".ckpt-sidebar .bundle-open input[type=file]", full.path);
  await ed.waitForFunction(() => document.querySelector(".notice")?.textContent?.startsWith("Opened"), null, { timeout: 30_000 });
  const note = await ed.textContent(".notice");
  check(/: 1 checkpoint added\./.test(note), `editor: opening the bundle says what was added ("${note}")`);
  await ed.waitForSelector(".ckpt-sidebar .ckpt", { timeout: 30_000 });
  check((await ed.$$(".ckpt-sidebar .ckpt")).length === 1, "editor: the bundle's checkpoint is in the list without a reload");
  await desk2.close();
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser?.close();
  server.kill();
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nbundle smoke passed");
