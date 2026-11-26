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

    await page.click(".view-bar button:has-text('Show final')").catch(() => {});
    // "+" after Threshold offers only steps that work on layers; picking one adds a box and selects it.
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.waitForSelector(".add-menu[role=menu]");
    const offered = await page.$$eval(".add-menu [role=menuitem]", (els) => els.map((e) => e.dataset.step).sort());
    check(offered.join(",") === "levels,pixelate", `"+" after Threshold offers only the steps that fit there (${offered.join(", ")})`);
    check(!(await page.$("aside.side select.add-step")), "the sidebar has no separate add-step list");
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('.strip .box[data-key="pixelate"].sel', { timeout: 10_000 });
    const order = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key));
    check(order.join(",") === "source,threshold,pixelate,centerline,order", `picking Pixelate adds its box there and selects it (${order.join(", ")})`);

    // Bypass works on a step that keeps its stage (Pixelate: layers in, layers out).
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

  // The "+" says why when nothing fits; dragging a box lights up only the gaps it fits in,
  // and dropping it there moves it and selects it. (A fresh page: this recipe isn't reloaded.)
  {
    const page = await open(1280);
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('.strip .box[data-key="pixelate"].sel', { timeout: 10_000 });
    const order = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key));

    // "+" after the last step: nothing fits, and it says why.
    await page.click(`.strip .box[data-key="${order.at(-1)}"] + .gap .plus`);
    const none = await page.textContent(".add-menu .add-none");
    check((await page.$$(".add-menu [role=menuitem]")).length === 0 && /Nothing fits here/.test(none), `"+" after the last step says why nothing fits ("${none}")`);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".add-menu", { state: "detached" });
    check(true, "Escape closes the add menu");

    // Drag to reorder: add Levels too, then drag it past Pixelate. Only valid gaps light up.
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="levels"]');
    await page.waitForSelector('.strip .box[data-key="levels"].sel');
    const b0 = await (await page.$('.strip .box[data-key="levels"] .pic')).boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 10, b0.y + b0.height / 2, { steps: 4 });
    const lit = await page.$$eval(".strip .gap.drop-ok", (els) => els.map((e) => e.dataset.gap));
    const dim = await page.$$eval(".strip .gap.drop-no", (els) => els.length);
    const hint = await page.textContent(".strip-head .strip-hint");
    check(lit.join(",") === "3" && dim > 0, `dragging Levels lights up only the gap it fits in (${lit.join(", ")}; ${dim} dimmed)`);
    check(/Levels can go in 1 other place/.test(hint), `the hint says how many places it can go ("${hint}")`);
    const t0 = await (await page.$('.strip .box[data-key="pixelate"] + .gap')).boundingBox();
    await page.mouse.move(t0.x + t0.width / 2, t0.y + t0.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(
      () => [...document.querySelectorAll(".strip .box")].map((e) => e.dataset.key).join(",") === "source,threshold,pixelate,levels,centerline,order",
      null,
      { timeout: 10_000 },
    );
    check(await page.$eval('.strip .box[data-key="levels"]', (e) => e.classList.contains("sel")), "dropping Levels moves it after Pixelate and selects it");
    await page.close();
  }

  // Pinned steps: pin by button and by dragging a box onto the sidebar; the step being
  // looked at stays on top; pins are marked in the strip, come back after a reload, aren't
  // a Back step, and go when their step is removed.
  {
    const page = await open(1280);
    const cards = () => page.$$eval("aside.side .card.step", (els) => els.map((e) => e.dataset.step + (e.classList.contains("focus") ? "*" : "")));
    const backOff = () => page.$eval("header.top button[aria-label=Back]", (b) => b.disabled);
    const pick = async (key) => {
      await page.click(`.strip .box[data-key="${key}"] .pic`);
      await page.waitForSelector(`aside.side .card.step.focus[data-step="${key}"]`, { timeout: 10_000 });
    };
    check(await backOff(), "pins: a fresh page has nothing to go Back to");

    await pick("threshold");
    await page.click('aside.side .card.focus .pin-btn');
    await page.waitForSelector('.strip .box[data-key="threshold"].pinned .pin-mark', { timeout: 5_000 });
    check((await page.getAttribute("aside.side .card.focus .pin-btn", "aria-pressed")) === "true", "the Pin button pins the step and its box gets a mark in the strip");
    check((await cards()).join(",") === "threshold*" && /pinned too/.test(await page.textContent("aside.side .steps")), `the selected step stays on top when pinned, shown once (${(await cards()).join(",")})`);

    await pick("centerline");
    check((await cards()).join(",") === "centerline*,threshold", `looking at another step: it on top, the pinned one below (${(await cards()).join(",")})`);

    // Drag the Stroke order box onto the sidebar.
    const b0 = await (await page.$('.strip .box[data-key="order"] .pic')).boundingBox();
    // Anywhere on the sidebar takes it (its drop note may be scrolled out of sight).
    const side = await (await page.$("aside.side")).boundingBox();
    const drop = { x: side.x, y: side.y + 60, width: side.width, height: 100 };
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 10, b0.y + b0.height / 2, { steps: 4 });
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('.strip .box[data-key="order"].pinned', { timeout: 5_000 }).catch(() => {});
    check((await cards()).join(",") === "centerline*,threshold,order", `dragging a box onto the sidebar pins it; pinned steps in recipe order (${(await cards()).join(",")})`);
    check(await backOff(), "pinning is not a Back step");

    // Story 26: Remove is off, with a reason, where it would break the chain; Switch off agrees with the strip.
    const actions = await page.$eval("aside.side .card.focus", (c) => ({
      remove: c.querySelector(".step-actions button:nth-child(3)").disabled,
      reason: c.querySelector(".reason")?.textContent ?? "",
      off: c.querySelector(".step-actions button:nth-child(1)").disabled,
    }));
    const strip = await page.getAttribute('.strip .box[data-key="centerline"] .byp', "aria-disabled");
    check(actions.remove && /Removing Centerline would break the chain/.test(actions.reason), `Remove is off with a reason when it would break the chain ("${actions.reason}")`);
    check(actions.off === (strip === "true"), `Switch off in the sidebar agrees with the strip's toggle (both ${actions.off ? "off" : "on"})`);

    // A reload brings the pins back (the selection isn't kept: every step shows).
    await page.reload();
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    await page.waitForSelector('.strip .box[data-key="order"].pinned', { timeout: 10_000 }).catch(() => {});
    const marks = await page.$$eval(".strip .box.pinned", (els) => els.map((e) => e.dataset.key));
    check(marks.join(",") === "threshold,order", `pins come back after a reload (${marks.join(", ")})`);
    await pick("centerline");
    check((await cards()).join(",") === "centerline*,threshold,order", "after the reload the pinned steps are in the sidebar again");

    // Unpin from a pinned card.
    await page.click('aside.side .card.step[data-step="threshold"] .pin-btn');
    await page.waitForSelector('.strip .box[data-key="threshold"]:not(.pinned)', { timeout: 5_000 });
    check((await cards()).join(",") === "centerline*,order", "Pinned on a pinned card unpins it");

    // Removing a pinned step removes its pin: the same step added again isn't pinned.
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('aside.side .card.step.focus[data-step="pixelate"]', { timeout: 10_000 });
    await page.click('aside.side .card.focus .pin-btn');
    await page.waitForSelector('.strip .box[data-key="pixelate"].pinned', { timeout: 5_000 });
    await page.click('aside.side .card.focus .step-actions button:has-text("Remove")');
    await page.waitForSelector('.strip .box[data-key="pixelate"]', { state: "detached", timeout: 5_000 });
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('.strip .box[data-key="pixelate"]', { timeout: 10_000 });
    check(!(await page.$('.strip .box[data-key="pixelate"].pinned')), "removing a pinned step removes its pin (a new Pixelate, same id, isn't pinned)");
    await page.close();
  }

  // Presets and checkpoints: the gallery draws each preset on your photo; picking one saves
  // a checkpoint first; Save checkpoint and ⌘S / Ctrl+S save at once with a confirmation;
  // restoring saves where you are first.
  {
    const page = await open(1280);
    check(!(await page.$("aside.side select.add-step >> text=Start from a preset")), "presets are no longer in the step list");
    await page.click("header.top .presets-btn");
    await page.waitForSelector("[role=dialog] .gallery .look");
    const n = await page.$$eval(".gallery .look", (els) => els.length);
    await page.waitForFunction(() => [...document.querySelectorAll(".gallery .look")].every((l) => l.querySelector("img") || l.textContent.includes("Can't preview")), null, { timeout: 120_000 });
    const pics = await page.$$eval(".gallery .look img", (els) => els.filter((i) => i.naturalWidth > 0).length);
    check(n >= 5 && pics === n, `Presets opens the gallery with each preset drawn on the photo (${pics} of ${n} pictures)`);
    const title = await page.textContent('.gallery .look[data-preset="topo-hatch"] .look-title');
    await page.click('.gallery .look[data-preset="topo-hatch"]');
    await page.waitForFunction(() => document.querySelector(".notice")?.textContent?.includes("saved as a checkpoint"), null, { timeout: 30_000 });
    check(!(await page.$("[role=dialog]")), "picking a preset closes the gallery and says the old settings are saved");

    await page.click("header.top button:has-text('Checkpoints')");
    await page.waitForSelector(".ckpt-sidebar .ckpt-explain");
    await page.waitForFunction((t) => [...document.querySelectorAll(".ckpt-sidebar .ckpt-name")].some((e) => e.textContent === `Before “${t}”`), title, { timeout: 10_000 });
    check(true, `the checkpoints list explains itself and holds “Before “${title}”” after picking the preset`);

    const count = () => page.$$eval(".ckpt-sidebar .ckpt", (els) => els.length);
    const c0 = await count();
    await page.click("header.top .cp-save");
    await page.waitForSelector(".toast:has-text('Checkpoint saved')", { timeout: 5_000 });
    await page.waitForFunction((c) => document.querySelectorAll(".ckpt-sidebar .ckpt").length === c + 1, c0, { timeout: 5_000 });
    check(true, "Save checkpoint saves at once and confirms");
    // Wait for the confirmation to go, so the next one is a new one.
    await page.waitForSelector(".toast", { state: "detached", timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForSelector(".toast:has-text('Checkpoint saved')", { timeout: 5_000 });
    await page.waitForFunction((c) => document.querySelectorAll(".ckpt-sidebar .ckpt").length === c + 2, c0, { timeout: 5_000 });
    check(true, "⌘S / Ctrl+S saves a checkpoint and confirms");
    await page.waitForFunction(() => [...document.querySelectorAll(".ckpt-sidebar .ckpt-thumb")].every((b) => b.querySelector("img")), null, { timeout: 30_000 });
    check(true, "every checkpoint gets its picture");

    // Restore the one saved before the preset: where you are is saved first.
    const c1 = await count();
    await page.click(`.ckpt-sidebar .ckpt:has(.ckpt-name:text-is("Before “${title}”")) .ckpt-thumb`);
    await page.waitForFunction(() => document.querySelector(".notice")?.textContent?.includes("Restored"), null, { timeout: 10_000 });
    const note = await page.textContent(".notice");
    // The current settings were just saved by ⌘S, so nothing new is needed.
    check(/already a checkpoint|saved as a checkpoint/.test(note) && (await count()) >= c1, `restoring says where you were is kept ("${note.split("\n")[0]}")`);
    await page.close();
  }

  // Plot mode on a two-ink recipe (CMYK, with only cyan and black turned into lines): the
  // time breakdown, one strip box per pen, solo, pass order (a Back step), the plot-order
  // animation, and output with Send off for a digital target.
  {
    const page = await open(1280);
    const recipe = {
      schemaVersion: 3,
      input: "image",
      target: { kind: "plotter" },
      paper: { widthMm: 297, heightMm: 210 },
      inks: [
        { id: "cyan", name: "Cyan", color: "#00a0d6", mix: "multiply", widthMm: 0.3 },
        { id: "black", name: "Black", color: "#1d1d1b", mix: "multiply", widthMm: 0.3 },
      ],
      layerInks: { C: "cyan", K: "black" },
      passOrder: "light-to-dark",
      machine: "generic",
      steps: [
        { step: "cmyk", params: { blackGeneration: 0.7 } },
        { step: "centerline", params: {}, layers: ["C", "K"] },
        { step: "order", params: {} },
      ],
    };
    await page.setInputFiles("aside.side input[type=file]", { name: "two-ink.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(recipe)) });
    await page.click(".modes button:has-text('Plot')");
    await page.waitForFunction(() => document.querySelectorAll(".pass-strip .box").length === 2, null, { timeout: 60_000 });
    await page.waitForSelector(".plot-time .bigtime", { timeout: 60_000 });
    const passes = () => page.$$eval(".pass-strip .box", (els) => els.map((e) => e.dataset.pass));
    const t = await page.evaluate(() => ({
      big: document.querySelector(".plot-time .bigtime").textContent,
      stats: document.querySelector(".stats .big").textContent,
      rows: [...document.querySelectorAll(".plot-time .breakdown .row")].map((r) => r.dataset.part),
      changes: document.querySelector('.plot-time .row[data-part="penChanges"] .detail').textContent,
    }));
    check(t.big === t.stats && t.rows.join(",") === "draw,travel,pen,penChanges" && t.changes === "1", `Plot mode: big time ${t.big} with drawing, travel, pen lifts, pen changes (${t.changes} pen change)`);
    check((await passes()).join(",") === "C,K", `the strip has one box per pen in pass order, light first (${(await passes()).join(", ")})`);
    await page.waitForFunction(() => [...document.querySelectorAll(".pass-strip .box .pic img")].length === 2, null, { timeout: 30_000 });
    check(true, "each pen box gets a picture of its lines");

    // Solo: only that pen's lines on the canvas; again (or All pens) shows both.
    const strokes = () => page.$$eval(".view svg.preview path[stroke]", (els) => els.map((e) => e.getAttribute("stroke")));
    check((await strokes()).length === 2, "both pens' lines are on the canvas");
    await page.click('.pass-strip .box[data-pass="K"] .pic');
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 1);
    check((await strokes())[0] === "#1d1d1b" && /Showing only Black/.test(await page.textContent(".view-bar")), "clicking the Black box shows only black lines");
    await page.click('.pass-strip .box[data-pass="K"] .pic');
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 2);
    await page.click('.pass-strip .box[data-pass="C"] .pic');
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 1);
    await page.click(".pass-strip .all-pens");
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 2);
    check(true, "clicking it again, or All pens, shows every pen");

    // Pass order: Black first, then Back undoes it.
    await page.click("aside.side button[aria-label='Plot Black earlier']");
    await page.waitForFunction(() => [...document.querySelectorAll(".pass-strip .box")].map((e) => e.dataset.pass).join(",") === "K,C", null, { timeout: 30_000 });
    const firstStroke = (await strokes())[0];
    check(firstStroke === "#1d1d1b", `moving Black earlier reorders the strip and the preview (first drawn: ${firstStroke})`);
    check(!(await page.$eval("header.top button[aria-label=Back]", (b) => b.disabled)), "a new pass order is a Back step");
    await page.click("header.top button[aria-label=Back]");
    await page.waitForFunction(() => [...document.querySelectorAll(".pass-strip .box")].map((e) => e.dataset.pass).join(",") === "C,K", null, { timeout: 30_000 });
    check(true, "Back puts the pass order back");
    // Showing one pen isn't an edit: an edit would clear Forward.
    await page.click('.pass-strip .box[data-pass="K"] .pic');
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 1);
    check(!(await page.$eval("header.top button[aria-label=Forward]", (b) => b.disabled)), "showing one pen is not an edit (Forward is still there)");
    await page.click(".pass-strip .all-pens");
    await page.waitForFunction(() => document.querySelectorAll(".view svg.preview path[stroke]").length === 2);

    // The animation: half way shows part of the plot with the pen marked; Play moves on.
    const full = await page.$eval(".view svg.preview", (e) => e.innerHTML.length);
    await page.$eval("aside.side input.scrub", (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, "500");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForSelector(".view svg.preview .pen-head");
    const half = await page.$eval(".view svg.preview", (e) => e.innerHTML.length);
    const where = await page.textContent("aside.side .play-where");
    check(half < full && /Pass \d of 2/.test(where), `scrubbing half way draws part of the plot with the pen marked ("${where}")`);
    await page.click("aside.side button.play");
    check((await page.textContent("aside.side button.play")) === "Pause", "Play starts the animation");
    await page.waitForFunction(() => Number(document.querySelector("aside.side input.scrub").value) > 520, null, { timeout: 10_000 });
    await page.click("aside.side button.play");
    check(true, "the animation moves on while playing, and Pause stops it");

    // Output: Send is on for a plotter; SVG and PNG come from the existing exporters.
    check(!(await page.$eval("aside.side button.send", (b) => b.disabled)), "Send to plotter is on for a plotter target");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.click('aside.side button[data-format="png"]')]);
    check(/\.png$/.test(dl.suggestedFilename()), `Download PNG saves ${dl.suggestedFilename()}`);
    check(!!(await page.$('aside.side button[data-format="svg"]')), "Download SVG is there too");

    // A digital target: Send is off and says why.
    await page.click(".modes button:has-text('Page')");
    await page.click(".target-grid button:has-text('Digital image')");
    await page.click(".modes button:has-text('Plot')");
    const send = await page.$eval("aside.side button.send", (b) => ({ off: b.disabled, why: document.querySelector("aside.side .send-why")?.textContent ?? "" }));
    check(send.off && /digital/.test(send.why), `Send is off for a digital target, with a reason ("${send.why}")`);
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
