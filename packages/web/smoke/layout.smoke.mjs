// Browser smoke test of the layout shell against a production build.
// Run with `pnpm --filter @plotlab/web smoke` (builds with BASE=/plotlab/ first).
// Needs Playwright's Chromium: `pnpm --filter @plotlab/web exec playwright install chromium`.
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
  const open = async (width, colorScheme = "light") => {
    const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme });
    await page.goto(APP_URL);
    // The first full run is done when the time estimate shows.
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    return page;
  };
  const layout = (page) =>
    page.evaluate(() => {
      const side = document.querySelector("aside.side").getBoundingClientRect();
      const header = document.querySelector("header.top").getBoundingClientRect();
      const visible = (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== "none";
      };
      const clipped = [...document.querySelectorAll("header.top > *")]
        .filter((el) => getComputedStyle(el).display !== "none")
        .filter((el) => el.getBoundingClientRect().right > header.right + 0.5)
        .map((el) => el.className || el.tagName);
      // The time estimate in the chip must not be cut off by the chip giving way.
      const chipEl = document.querySelector("header.top .setup-chip");
      const time = chipEl?.querySelector(".time")?.getBoundingClientRect();
      const timeShown = !!time && time.width > 0 && time.right <= chipEl.getBoundingClientRect().right + 0.5;
      return {
        timeShown,
        sideLeft: side.left,
        sideRight: side.right,
        sideWidth: side.width,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        chip: visible("header.top .setup-chip"),
        name: visible("header.top .project-name"),
        clipped,
      };
    });

  // 960 px: the sidebar is fully visible and the page doesn't scroll sideways.
  {
    const page = await open(960);
    const l = await layout(page);
    check(l.sideLeft >= 0 && l.sideRight <= l.innerWidth && l.sideWidth >= 250, `960 px: sidebar fully visible (${l.sideLeft.toFixed(0)}–${l.sideRight.toFixed(0)} of ${l.innerWidth})`);
    check(l.scrollWidth <= l.clientWidth, `960 px: no sideways scroll (${l.scrollWidth} ≤ ${l.clientWidth})`);
    check(!l.chip && !l.name, "960 px: project name and setup chip leave the top bar");
    check(l.clipped.length === 0, `960 px: nothing in the top bar is cut off ${l.clipped.join(", ")}`);
    await page.close();
  }

  // 1100 px: the sidebar narrows.
  {
    const page = await open(1100);
    const l = await layout(page);
    check(l.sideWidth < 320 && l.sideRight <= l.innerWidth, `1100 px: sidebar narrows (${l.sideWidth} px)`);
    check(l.chip && l.timeShown && l.clipped.length === 0, `1100 px: setup chip shows with its time, nothing is cut off ${l.clipped.join(", ")}`);
    await page.close();
  }
  for (const w of [970, 1200, 1241, 1440]) {
    const page = await open(w);
    const l = await layout(page);
    check(l.chip && l.timeShown && l.clipped.length === 0 && l.scrollWidth <= l.clientWidth, `${w} px: setup chip shows with its time, nothing cut off, no sideways scroll`);
    await page.close();
  }

  // 1280 px: modes and the setup chip.
  {
    const page = await open(1280);
    const l = await layout(page);
    check(l.chip && l.timeShown && l.name && l.sideWidth >= 330 && l.clipped.length === 0, "1280 px: project name, setup chip with its time, full-width sidebar");
    const design = await page.evaluate(() => ({ steps: !!document.querySelector("aside.side .steps"), paper: !!document.querySelector("aside.side .page-panel") }));
    check(design.steps && !design.paper, "Design mode: step settings in the sidebar, no page settings");
    await page.click("header.top .setup-chip");
    const pressed = await page.textContent(".modes button[aria-pressed=true]");
    const pageMode = await page.evaluate(() => ({ steps: !!document.querySelector("aside.side .steps"), paper: !!document.querySelector("aside.side .page-panel") }));
    check(pressed === "Page" && pageMode.paper && !pageMode.steps, "the setup chip opens Page mode");
    await page.click(".modes button:has-text('Plot')");
    check(!!(await page.$("aside.side .plot-panel")), "Plot mode shows the output panel");
    await page.close();
  }

  // The step strip: thumbnails of every step; clicking one shows that step on the canvas
  // and its settings in the sidebar.
  {
    const page = await open(1280);
    await page.waitForFunction(() => document.querySelectorAll(".strip .box .pic img").length === document.querySelectorAll(".strip .box").length, null, { timeout: 30_000 });
    const keys = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key));
    check(keys[0] === "source" && keys.length >= 3, `strip: the source plus one box per step, each with a thumbnail (${keys.join(", ")})`);
    const snap = () =>
      page.evaluate(() => ({
        canvas: document.querySelector(".view svg.preview").innerHTML,
        bar: document.querySelector(".view-bar").textContent,
        cards: [...document.querySelectorAll("aside.side .card.step .title")].map((e) => e.textContent),
      }));
    const before = await snap();
    const first = keys[1];
    const title = await page.textContent(`.strip .box[data-key="${first}"] .name`);
    await page.click(`.strip .box[data-key="${first}"] .pic`);
    await page.waitForFunction((t) => document.querySelector(".view-bar")?.textContent?.includes(`${t} output`), title, { timeout: 30_000 });
    await page.waitForFunction((html) => document.querySelector(".view svg.preview").innerHTML !== html, before.canvas, { timeout: 30_000 });
    const after = await snap();
    check(after.canvas !== before.canvas, `clicking the ${title} thumbnail changes the canvas`);
    check(before.cards.length > 1 && after.cards.length === 1 && after.cards[0] === title, `clicking the ${title} thumbnail puts its settings in the sidebar (${before.cards.length} cards → ${after.cards.join(", ")})`);
    check(await page.$eval(`.strip .box[data-key="${first}"]`, (e) => e.classList.contains("sel")), "the clicked box is marked as selected");

    // Show final goes back to the result.
    await page.click(".view-bar button:has-text('Show final')");
    await page.waitForFunction(() => !document.querySelector(".view-bar")?.textContent?.includes("Viewing"));
    check((await snap()).cards.length === before.cards.length, "Show final goes back to the result and every step's settings");

    // Keyboard: Enter on a focused box selects it.
    await page.focus(`.strip .box[data-key="source"] button.pick`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".view-bar")?.textContent?.includes("the source"), null, { timeout: 10_000 });
    check(true, "Enter on a focused box selects it");

    // Bypass: a stage-changing step (the first one turns the image into layers) can't be switched off, and says why.
    const byp = await page.$eval(`.strip .box[data-key="${first}"] .byp`, (e) => ({ disabled: e.getAttribute("aria-disabled"), label: e.getAttribute("aria-label") }));
    check(byp.disabled === "true" && /Can't switch off/.test(byp.label), `bypass is off on a stage-changing step, with a reason ("${byp.label}")`);

    // Bypass works on a step that keeps its stage (Pixelate: layers in, layers out).
    await page.click(".view-bar button:has-text('Show final')").catch(() => {});
    await page.selectOption("aside.side select.add-step >> nth=-1", "pixelate");
    await page.waitForSelector('.strip .box[data-key="pixelate"]');
    await page.click('.strip .box[data-key="pixelate"] .byp');
    await page.waitForSelector('.strip .box[data-key="pixelate"].off', { timeout: 10_000 });
    await page.click('.strip .box[data-key="pixelate"] .byp');
    await page.waitForSelector('.strip .box[data-key="pixelate"]:not(.off)', { timeout: 10_000 });
    check(true, "bypass switches a same-stage step off and on again");

    // The strip size is remembered by this browser.
    const size0 = await page.$eval(".strip .box .pic", (e) => e.getBoundingClientRect().width);
    await page.click("button[aria-label='Bigger thumbnails']");
    const size1 = await page.$eval(".strip .box .pic", (e) => e.getBoundingClientRect().width);
    await page.reload();
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    const size2 = await page.$eval(".strip .box .pic", (e) => e.getBoundingClientRect().width);
    check(size1 > size0 && size2 === size1, `strip size grows with + and is remembered after a reload (${size0} → ${size1} → ${size2})`);
    await page.close();
  }

  // Dark mode: the chrome goes dark, the paper stays paper-coloured.
  {
    const page = await open(1280, "dark");
    const c = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, paper: getComputedStyle(document.querySelector(".paper")).fill }));
    check(c.body === "rgb(27, 26, 24)", `dark mode: chrome is dark (${c.body})`);
    check(c.paper === "rgb(255, 253, 248)", `dark mode: paper stays paper-coloured (${c.paper})`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
