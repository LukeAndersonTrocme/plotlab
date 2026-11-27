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

  // Phone (#74): under 700 px a viewer replaces the editor, and it works by touch.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(APP_URL);
    await page.waitForSelector(".phone-project", { timeout: 30_000 });
    check(!(await page.$(".app")) && !(await page.$("aside.side")), "phone: the editor isn't there at 390 px");
    check(/sample to look at/.test(await page.textContent(".phone")), "phone: a fresh browser shows the sample to look at");
    await page.tap(".phone-project");
    await page.waitForSelector(".compare[role=slider]", { timeout: 60_000 });
    await page.waitForSelector(".phone-box .pic img", { timeout: 60_000 });
    const before = Number(await page.getAttribute(".compare", "aria-valuenow"));
    const box = await page.locator(".compare").boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
    const tapped = Number(await page.getAttribute(".compare", "aria-valuenow"));
    check(before === 50 && Math.abs(tapped - 20) <= 2, `phone: a tap moves the before/after line (${before}% → ${tapped}%)`);
    const clip = await page.$eval(".compare-after", (el) => el.style.clipPath);
    check(/^inset\(0(px)? 0(px)? 0(px)? (19|20|21)/.test(clip), `phone: the plot shows right of the line (${clip})`);
    await page.mouse.move(box.x + box.width * 0.3, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + 20, { steps: 4 });
    await page.mouse.up();
    const dragged = Number(await page.getAttribute(".compare", "aria-valuenow"));
    check(Math.abs(dragged - 80) <= 2, `phone: dragging moves it too (${dragged}%)`);
    const strip = await page.$eval(".phone-strip", (el) => ({ scroll: el.scrollWidth, width: el.clientWidth, page: document.documentElement.scrollWidth, inner: window.innerWidth }));
    check(strip.scroll > strip.width && strip.page <= strip.inner, `phone: the strip scrolls sideways, the page doesn't (${strip.scroll} > ${strip.width}, page ${strip.page})`);
    await page.tap(".phone-box >> nth=1");
    const shown = await page
      .waitForFunction(() => /^Step 1/.test(document.querySelector(".phone-caption")?.textContent ?? ""), null, { timeout: 30_000 })
      .then(() => true, () => false);
    check(shown, "phone: tapping a step in the strip shows that step");
    await page.tap(".phone-stage-bar .phone-full");
    const full = await page.$eval(".phone-stage", (el) => {
      const r = el.getBoundingClientRect();
      return r.width === window.innerWidth && r.height === window.innerHeight;
    });
    check(full, "phone: Full screen fills the screen");
    await page.tap(".phone-stage-bar .phone-full");
    await ctx.close();
  }

  // Laptop to phone width and back: the editor stays (hidden) so nothing is lost, and the
  // viewer shows the stored project and its checkpoint without saving anything.
  {
    const page = await open(1280);
    const backOff = () => page.$eval("header.top button[aria-label=Back]", (b) => b.disabled);
    await page.click('.strip .box[data-key="threshold"] .pic');
    await page.focus('aside.side .card.step.focus[data-step="threshold"] input[type=range]');
    await page.keyboard.press("ArrowRight");
    check(!(await backOff()), "laptop: changing a setting is a Back step");
    // Save a checkpoint and narrow at once: its picture is still being drawn.
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForSelector(".toast", { timeout: 10_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector(".phone-project", { timeout: 30_000 });
    const hidden = await page.$eval(".app", (el) => el.getBoundingClientRect().width === 0 && el.closest("[hidden]") !== null);
    check(hidden, "resizing under 700 px hides the editor behind the viewer");
    const meta = await page.textContent(".phone-project-meta");
    check(meta === "1 checkpoint" && !/sample to look at/.test(await page.textContent(".phone")), `phone: the stored project shows with its checkpoint ("${meta}")`);
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+s");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector(".app", { state: "visible", timeout: 10_000 });
    check(!(await page.$(".phone")), "widening again brings the editor back");
    check(!(await backOff()), "the editor kept its Back step (and took no keys while hidden)");
    await page.keyboard.press("s");
    await page.waitForSelector(".ckpt", { timeout: 10_000 });
    check((await page.$$(".ckpt")).length === 1, "still one checkpoint: the viewer saved nothing, nor did keys pressed on it");
    const pic = await page.waitForSelector(".ckpt-thumb img", { timeout: 30_000 }).then(() => true, () => false);
    check(pic, "the checkpoint saved just before narrowing got its picture");
    await page.keyboard.press("s");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click(".phone-project");
    await page.waitForSelector(".phone-ckpt:not(.sel) .phone-ckpt-pic img", { timeout: 30_000 });
    check(true, "phone: the checkpoint shows its saved picture");
    await page.click(".phone-ckpt:not(.sel)");
    check((await page.getAttribute(".phone-ckpt:nth-child(2)", "aria-pressed")) === "true", "phone: tapping a checkpoint shows that version");
    await page.close();
  }

  // Compare stages (#75): turn it on, strips for the step and the one before; shift-click
  // adds a strip, a plain click only changes the sidebar; every strip changes while a slider
  // moves; dividers drag and can't cross; the comparison comes back after a reload.
  {
    const page = await open(1280);
    const bands = () => page.$$eval(".compare-canvas .strip-band", (els) => els.map((e) => e.dataset.band));
    const pics = () => page.$$eval(".compare-canvas .strip-band", (els) => els.map((e) => e.innerHTML));
    const drawn = (n) => page.waitForFunction((n) => {
      const els = [...document.querySelectorAll(".compare-canvas .strip-band")];
      return els.length === n && els.every((e) => e.querySelector("image, path"));
    }, n, { timeout: 30_000 });
    await page.click('.strip .box[data-key="threshold"] .pic');
    await page.waitForSelector('aside.side .card.step.focus[data-step="threshold"]', { timeout: 10_000 });
    await page.click(".view-bar button:has-text('Compare stages')");
    await drawn(2);
    check((await bands()).join(",") === "source,threshold", `compare: turning it on shows the first step against the source (${(await bands()).join(", ")})`);

    await page.click('.strip .box[data-key="order"] .pic', { modifiers: ["Shift"] });
    await drawn(3);
    check((await bands()).join(",") === "source,threshold,order", `compare: shift-click adds that step as a strip (${(await bands()).join(", ")})`);
    check(!!(await page.$('aside.side .card.step.focus[data-step="threshold"]')), "compare: shift-click leaves the sidebar alone");
    check(await page.$eval("header.top button[aria-label=Back]", (b) => b.disabled), "compare: turning it on and adding strips is not a Back step");
    await page.click('.strip .box[data-key="centerline"] .pic');
    await page.waitForSelector('aside.side .card.step.focus[data-step="centerline"]', { timeout: 10_000 });
    check((await bands()).join(",") === "source,threshold,order", "compare: a plain click changes only the sidebar, not the strips");

    // Drag Threshold's first slider and see every step strip change before letting go.
    await page.click('.strip .box[data-key="threshold"] .pic');
    await page.waitForSelector('aside.side .card.step.focus[data-step="threshold"]', { timeout: 10_000 });
    const before = await pics();
    const range = await (await page.$('aside.side .card.step.focus[data-step="threshold"] input[type=range]')).boundingBox();
    const y = range.y + range.height / 2;
    await page.mouse.move(range.x + range.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(range.x + range.width * 0.15, y, { steps: 6 });
    const live = await page.waitForFunction((b) => {
      const now = [...document.querySelectorAll(".compare-canvas .strip-band")].map((e) => e.innerHTML);
      return now.length === b.length && now[1] !== b[1] && now[2] !== b[2] && now[1].includes("<image") && /<path|<image/.test(now[2]);
    }, before, { timeout: 30_000 }).then(() => true, () => false);
    await page.mouse.up();
    check(live, "compare: moving a slider changes every step's strip while the slider moves");
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/compare-cols.png` });
    check(!(await page.$eval("header.top button[aria-label=Back]", (b) => b.disabled)), "compare: the slider move is a Back step");

    // Dividers: drag the first one far past the second; it stops short.
    const val = () => page.$$eval(".compare-canvas .cmp-divider", (els) => els.map((e) => Number(e.getAttribute("aria-valuenow"))));
    const v0 = await val();
    const knob = await (await page.$(".compare-canvas .cmp-divider circle")).boundingBox();
    const svg = await (await page.$(".compare-canvas")).boundingBox();
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await page.mouse.down();
    await page.mouse.move(svg.x + svg.width - 5, knob.y + knob.height / 2, { steps: 8 });
    await page.mouse.up();
    const v1 = await val();
    check(v0.length === 2 && v1[0] > v0[0] && v1[0] < v1[1], `compare: a divider drags but can't cross the next one (${v0.join(",")} → ${v1.join(",")})`);

    // Top to bottom, then a reload: the comparison comes back as it was.
    await page.click(".compare-bar button:has-text('Top to bottom')");
    await page.waitForSelector(".compare-canvas.rows");
    await page.waitForTimeout(300);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/compare-rows.png` });
    await page.reload();
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    await page.waitForSelector(".compare-canvas.rows", { timeout: 10_000 }).catch(() => {});
    await drawn(3).catch(() => {});
    check((await bands()).join(",") === "source,threshold,order" && !!(await page.$(".compare-canvas.rows")), `compare: the comparison comes back after a reload (${(await bands()).join(", ")})`);
    check((await val())[0] === v1[0], `compare: so do the dividers (${(await val()).join(",")})`);

    // Removing a compared step drops its strip; the same step added again doesn't come back as a strip.
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('aside.side .card.step.focus[data-step="pixelate"]', { timeout: 10_000 });
    await page.click('.strip .box[data-key="pixelate"] .pic', { modifiers: ["Shift"] });
    await drawn(4);
    await page.click('aside.side .card.focus .step-actions button:has-text("Remove")');
    await drawn(3);
    await page.click('.strip .gap[data-gap="1"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('.strip .box[data-key="pixelate"]', { timeout: 10_000 });
    await page.waitForTimeout(200);
    check((await bands()).join(",") === "source,threshold,order", `compare: removing a step drops its strip, and a new one with its id isn't compared (${(await bands()).join(", ")})`);

    await page.click(".view-bar button:has-text('Compare stages')");
    await page.waitForSelector(".compare-canvas", { state: "detached" });
    check(!!(await page.$(".view svg.preview")), "compare: turning it off shows the single canvas again");
    await page.close();
  }

  // Compare stages, Lens and Boxes (#76): the lens drags and resizes (the wheel only over it);
  // boxes are drawn, moved, resized and removed; both change while a slider moves; both come
  // back after a reload.
  {
    const page = await open(1280);
    const has = (sel) => page.waitForFunction((sel) => {
      const els = [...document.querySelectorAll(sel)];
      return els.length > 0 && els.every((e) => e.querySelector("image, path"));
    }, sel, { timeout: 30_000 });
    const lens = () => page.$eval(".compare-canvas .cmp-lens-ring", (e) => ({ x: Number(e.dataset.x), y: Number(e.dataset.y), r: Number(e.dataset.r) }));
    const rects = () => page.$$eval(".compare-canvas .cmp-box-frame", (els) => els.map((e) => e.dataset.rect));
    const paper = async () => (await page.$(".compare-canvas > rect.paper")).boundingBox();
    const at = (p, fx, fy) => [p.x + p.width * fx, p.y + p.height * fy];
    let pos = 0.15;
    const slide = async (sel) => {
      const before = await page.$$eval(sel, (els) => els.map((e) => e.innerHTML));
      const range = await (await page.$('aside.side .card.step.focus[data-step="threshold"] input[type=range]')).boundingBox();
      const y = range.y + range.height / 2;
      await page.mouse.move(range.x + range.width * 0.5, y);
      await page.mouse.down();
      await page.mouse.move(range.x + range.width * pos, y, { steps: 6 });
      pos += 0.2;
      const live = await page.waitForFunction(([sel, b]) => {
        const now = [...document.querySelectorAll(sel)].map((e) => e.innerHTML);
        return now.length === b.length && now.every((h, i) => h !== b[i] && /<path|<image/.test(h));
      }, [sel, before], { timeout: 30_000 }).then(() => true, () => false);
      await page.mouse.up();
      return live;
    };
    await page.click('.strip .box[data-key="threshold"] .pic');
    await page.waitForSelector('aside.side .card.step.focus[data-step="threshold"]', { timeout: 10_000 });
    await page.click(".view-bar button:has-text('Compare stages')");
    await page.click(".compare-bar button:has-text('Lens')");
    await page.waitForSelector(".compare-canvas.lens");
    await has(".compare-canvas .cmp-under");
    await has(".compare-canvas .cmp-lens");
    const ub = [await page.getAttribute(".cmp-under", "data-band"), await page.getAttribute(".cmp-lens", "data-band")];
    check(ub.join(",") === "source,threshold", `lens: the step before under the lens, the step in it (${ub.join(", ")})`);

    // Drag the lens by its middle.
    const l0 = await lens();
    let p = await paper();
    const [lx, ly] = at(p, l0.x, l0.y);
    await page.mouse.move(lx, ly);
    await page.mouse.down();
    await page.mouse.move(lx - p.width * 0.2, ly + p.height * 0.1, { steps: 6 });
    await page.mouse.up();
    const l1 = await lens();
    check(l1.x < l0.x - 0.1 && l1.y > l0.y + 0.05 && l1.r === l0.r, `lens: drags (${l0.x},${l0.y} → ${l1.x},${l1.y})`);
    // The wheel over the lens resizes it; elsewhere it leaves the lens alone.
    await page.mouse.move(...at(p, l1.x, l1.y));
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    const l2 = await lens();
    await page.mouse.move(...at(p, 0.97, 0.03));
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    const l3 = await lens();
    check(l2.r > l1.r && l3.r === l2.r, `lens: the wheel resizes it only while over it (${l1.r} → ${l2.r} → ${l3.r})`);
    await page.fill(".compare-bar input[aria-label='Lens size']", "0.3");
    await page.waitForTimeout(150);
    check((await lens()).r === 0.3, `lens: the size slider resizes it (${(await lens()).r})`);
    check(await page.$eval("header.top button[aria-label=Back]", (b) => b.disabled), "lens: dragging and resizing it is not a Back step");
    check(await slide(".compare-canvas .cmp-lens"), "lens: moving a slider changes what's in the lens while the slider moves");
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/compare-lens.png` });
    const lensKept = await lens();

    // Boxes: one to start with; draw one, click for a default one, move, resize, remove.
    await page.click(".compare-bar button:has-text('Boxes')");
    await page.waitForSelector(".compare-canvas.boxes");
    check((await rects()).length === 1, `boxes: switching to boxes starts with one (${(await rects()).length})`);
    p = await paper();
    await page.mouse.move(...at(p, 0.05, 0.7));
    await page.mouse.down();
    await page.mouse.move(...at(p, 0.25, 0.9), { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll(".compare-canvas .cmp-box-frame").length === 2);
    const drawnBox = (await rects())[1].split(",").map(Number);
    check(Math.abs(drawnBox[0] - 0.05) < 0.02 && Math.abs(drawnBox[2] - 0.2) < 0.02, `boxes: dragging on the image draws a box (${drawnBox.join(",")})`);
    await page.mouse.click(...at(p, 0.85, 0.2));
    await page.waitForFunction(() => document.querySelectorAll(".compare-canvas .cmp-box-frame").length === 3);
    const clicked = (await rects())[2].split(",").map(Number);
    check(clicked[2] === 0.28 && clicked[3] === 0.28, `boxes: a click without dragging makes a default-sized box (${clicked.join(",")})`);
    const bands = await page.$$eval(".compare-canvas .cmp-box", (els) => els.map((e) => e.dataset.band));
    check(bands[1] === "threshold" && bands[2] === "threshold", `boxes: a drawn box shows the step being looked at (${bands.join(", ")})`);
    // Move box 2 by its middle, then resize it from its corner.
    await page.mouse.move(...at(p, 0.15, 0.8));
    await page.mouse.down();
    await page.mouse.move(...at(p, 0.25, 0.75), { steps: 6 });
    await page.mouse.up();
    const moved = (await rects())[1].split(",").map(Number);
    check(moved[0] > drawnBox[0] + 0.05 && moved[2] === drawnBox[2], `boxes: a box moves (${drawnBox.join(",")} → ${moved.join(",")})`);
    const corner = await (await page.$$(".compare-canvas .cmp-box-corner"))[1].boundingBox();
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + p.width * 0.1, corner.y + corner.height / 2, { steps: 6 });
    await page.mouse.up();
    const resized = (await rects())[1].split(",").map(Number);
    check(resized[2] > moved[2] + 0.05 && resized[0] === moved[0], `boxes: a box resizes from its corner (${moved.join(",")} → ${resized.join(",")})`);
    await page.click(".compare-bar button[aria-label='Remove box 3']");
    const removed = await page.waitForFunction(() => document.querySelectorAll(".compare-canvas .cmp-box-frame").length === 2, null, { timeout: 5_000 }).then(() => true, () => false);
    check(removed, "boxes: a box is removed from its chip");
    await has(".compare-canvas .cmp-box");
    check(await slide(".compare-canvas .cmp-box"), "boxes: moving a slider changes every box while the slider moves");
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/compare-boxes.png` });
    const boxesKept = await rects();

    // A reload brings the boxes back, and the lens where it was.
    await page.reload();
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    await page.waitForSelector(".compare-canvas.boxes", { timeout: 10_000 }).catch(() => {});
    const back = await rects().catch(() => []);
    check(JSON.stringify(back) === JSON.stringify(boxesKept), `boxes: they come back after a reload (${back.join(" | ")})`);
    await page.click(".compare-bar button:has-text('Lens')");
    await page.waitForSelector(".compare-canvas.lens");
    check(JSON.stringify(await lens()) === JSON.stringify(lensKept), `lens: it comes back where it was after a reload (${JSON.stringify(await lens())})`);
    await page.close();
  }

  // CMYK lanes (#77): "Split into CMYK" on the source's sidebar gives one row of 2×2 thumbnails
  // (one ink in each corner) and a Stack box; Undo the split brings the single chain back;
  // Separate CMYK from the "+" right after the source splits the same way.
  {
    const page = await open(1280);
    const keys = () => page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key).join(","));
    const before = await keys();
    await page.click('.strip .box[data-key="source"] .pic');
    await page.click("aside.side .split-card button:has-text('Split into CMYK')");
    await page.waitForSelector(".strip .box.lane.split", { timeout: 30_000 });
    const after = await keys();
    check(after === "source,cmyk,centerline,@stack,order", `Split into CMYK: the split and the lane steps, then a Stack box (${after})`);
    const bar = await page.textContent(".strip-head .lanes-bar");
    check(/C M Y K/.test(bar) && /Linked/.test(bar) && (await page.isChecked(".lanes-bar input[type=checkbox]")), `the strip says the four inks are linked, screen angles on ("${bar}")`);
    // The split's thumbnail is a 2×2: cyan top left, magenta top right, yellow bottom left, black bottom right.
    const quadsOf = (key, need = 4) =>
      page.waitForFunction(
        ({ k, need }) => {
          const img = document.querySelector(`.strip .box[data-key="${k}"] .pic img`);
          if (!img || !img.complete || !img.naturalWidth) return null;
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          const w = c.width >> 1, h = c.height >> 1;
          const avg = (x0, y0) => {
            const d = g.getImageData(x0, y0, w, h).data;
            let r = 0, gg = 0, b = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) continue; // bare paper
              r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
            }
            return n ? [r / n, gg / n, b / n].map(Math.round) : null;
          };
          const q = [avg(0, 0), avg(w, 0), avg(0, h), avg(w, h)];
          return q.filter(Boolean).length >= need ? q : null;
        },
        { k: key, need },
        { timeout: 30_000 },
      ).then((h) => h.jsonValue());
    const [c, m, y, k] = await quadsOf("cmyk");
    const grey = Math.max(...k) - Math.min(...k) < 25 && Math.max(...k) < 220;
    const cmykOk = c[2] > c[0] + 40 && m[0] > m[1] + 40 && y[0] > y[2] + 40 && y[1] > y[2] + 40 && grey;
    check(cmykOk, `the split's thumbnail is 2×2 C / M / Y / K (${JSON.stringify([c, m, y, k])})`);
    // A lane step (Centerline) draws each ink's lines in its own corner (an ink may have none here).
    const lane = await quadsOf("centerline", 2);
    const laneOk = !!lane[0] && lane[0][2] > lane[0][0] + 40 && !!lane[1] && lane[1][0] > lane[1][1] + 40 && (await page.$('.strip .box[data-key="centerline"] .pic.quad')) !== null;
    check(laneOk, `a lane step's thumbnail is 2×2 too (${JSON.stringify(lane)})`);
    await page.waitForFunction(() => document.querySelector('.strip .box[data-key="@stack"] .pic img')?.naturalWidth > 0, null, { timeout: 30_000 });
    await page.click('.strip .box[data-key="@stack"] .pic');
    await page.waitForSelector('.strip .box[data-key="@stack"].sel', { timeout: 10_000 });
    check((await page.textContent(".view-bar")).includes("Result"), "the Stack box has a thumbnail and shows all the inks together (the result)");

    await page.click(".lanes-bar button:has-text('Undo the split')");
    await page.waitForFunction((b) => [...document.querySelectorAll(".strip .box")].map((e) => e.dataset.key).join(",") === b, before, { timeout: 30_000 });
    check(!(await page.$(".strip .lanes-bar")) && !(await page.$(".strip .box.stack")), `Undo the split brings back the single chain (${await keys()})`);

    await page.click('.strip .gap[data-gap="0"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="cmyk"]');
    await page.waitForSelector(".strip .box.stack", { timeout: 30_000 });
    check((await keys()) === "source,cmyk,centerline,@stack,order", `Separate CMYK from the "+" after the source splits the same way (${await keys()})`);
    await page.close();
  }

  // Independent inks (#78): split, unlink, then build "pixelated magenta, stippled yellow" from
  // the lanes: Pixelate in M's lane, Centerline out of Y's lane, Stipple in Y's lane. Then the
  // lane tabs, dragging a lane (pass order), the Stack panel, hiding an ink and linking again.
  {
    const page = await open(1400);
    const rows = () => page.$$eval(".lane-row", (els) => els.map((e) => `${e.dataset.lane}:${[...e.querySelectorAll(".box")].map((b) => b.dataset.key.split("@")[0]).join("+")}`).join(" "));
    await page.click('.strip .box[data-key="source"] .pic');
    await page.click("aside.side .split-card button:has-text('Split into CMYK')");
    await page.waitForSelector(".strip .box.lane.split", { timeout: 30_000 });
    await page.click(".lanes-bar button:has-text('Independent')");
    await page.waitForSelector(".lane-rows", { timeout: 10_000 });
    const unlinked = await rows();
    check((await page.$$(".lane-row")).length === 4 && unlinked.split(" ").every((r) => /^\w:centerline$/.test(r)), `Independent: four lanes, each still showing what it showed (${unlinked})`);

    await page.click('.lane-gap[data-lane-gap="M:0"] .plus');
    const offered = await page.$$eval(".add-menu [role=menuitem]", (els) => els.map((e) => e.dataset.step));
    check(offered.includes("pixelate") && !offered.includes("order"), `a lane's "+" offers steps for that ink only (${offered.join(",")})`);
    await page.click('.add-menu [role=menuitem][data-step="pixelate"]');
    await page.waitForSelector('.lane-row[data-lane="M"] .box[data-key="pixelate@M"]', { timeout: 10_000 });
    await page.click('.box[data-key="centerline@Y"] .pick');
    await page.click("aside.side button:has-text('Take out of Yellow')");
    await page.waitForFunction(() => !document.querySelector('.box[data-key="centerline@Y"]'), null, { timeout: 10_000 });
    await page.click('.lane-gap[data-lane-gap="Y:0"] .plus');
    await page.click('.add-menu [role=menuitem][data-step="stipple"]');
    await page.waitForSelector('.box[data-key="stipple@Y"]', { timeout: 10_000 });
    await page.click("aside.side button:has-text('Run stipple')");
    const built = await rows();
    check(/M:pixelate\+centerline/.test(built) && /Y:stipple(\s|$)/.test(built) && /C:centerline/.test(built) && /K:centerline/.test(built), `pixelated magenta, stippled yellow, built from the lanes (${built})`);
    // Each lane box shows its ink alone: Stipple's thumbnail is yellow, Pixelate's magenta.
    const tint = (key) =>
      page
        .waitForFunction(
          (k) => {
            const img = document.querySelector(`.box[data-key="${k}"] .pic img`);
            if (!img || !img.complete || !img.naturalWidth) return null;
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let r = 0, gg = 0, b = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) continue; // bare paper
              r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
            }
            return n ? [r / n, gg / n, b / n].map(Math.round) : null;
          },
          key,
          { timeout: 60_000 },
        )
        .then((h) => h.jsonValue());
    const y = await tint("stipple@Y");
    const m = await tint("pixelate@M");
    check(y[0] > y[2] + 40 && y[1] > y[2] + 40 && m[0] > m[1] + 40, `lane boxes show their own ink: Stipple yellow ${JSON.stringify(y)}, Pixelate magenta ${JSON.stringify(m)}`);

    // The Stack panel (the Stack box): per-ink lines and time, in pass order.
    await page.click('.strip .box[data-key="@stack"] .pic');
    await page.waitForFunction(() => [...document.querySelectorAll(".stack-row")].filter((r) => /lines? · ~/.test(r.textContent)).length >= 3, null, { timeout: 60_000 });
    const stack = await page.$$eval(".stack-row", (els) => els.map((e) => `${e.dataset.ink}:${e.querySelector(".stack-stat").textContent}`));
    check(stack.length === 4 && /Y:[\d,]+ lines · ~/.test(stack.join("|")) && /M:[\d,]+ lines? · ~/.test(stack.join("|")), `the Stack panel lists each ink's lines and time (${stack.join(" | ")})`);
    const passOrder = () => page.$$eval(".stack-row", (els) => els.map((e) => e.dataset.ink).join(""));
    const laneOrder = () => page.$$eval(".lane-row", (els) => els.map((e) => e.dataset.lane).join(""));
    check((await passOrder()) === (await laneOrder()), `lane order is the pass order (${await laneOrder()})`);

    // Dragging a lane's handle changes the pass order, and the Stack panel follows.
    const before = await laneOrder();
    await page.dragAndDrop(`.lane-head[data-lane-handle="${before[1]}"]`, `.lane-row[data-lane="${before[0]}"]`);
    await page.waitForFunction((b) => [...document.querySelectorAll(".lane-row")].map((e) => e.dataset.lane).join("") !== b, before, { timeout: 30_000 }).catch(() => {});
    const dragged = await laneOrder();
    await page.waitForFunction((o) => [...document.querySelectorAll(".stack-row")].map((e) => e.dataset.ink).join("") === o, dragged, { timeout: 30_000 }).catch(() => {});
    check(dragged === before[1] + before[0] + before.slice(2) && (await passOrder()) === dragged, `dragging a lane updates the pass order and the stack (${before} → ${dragged}, stack ${await passOrder()})`);
    // The Stack panel's arrows do the same.
    const first = dragged[0];
    await page.click(`.stack-row[data-ink="${first}"] button[aria-label="Plot ${await page.textContent(`.stack-row[data-ink="${first}"] .layer-name`)} later"]`);
    await page.waitForFunction((f) => document.querySelector(".lane-row")?.dataset.lane !== f, first, { timeout: 30_000 }).catch(() => {});
    check((await laneOrder())[1] === first, `the Stack panel's ↓ moves an ink later, and its lane follows (${dragged} → ${await laneOrder()})`);

    // Hiding an ink is only the view: the canvas loses it, the plot (strokes) doesn't.
    const stats = await page.textContent(".stats .big");
    await page.uncheck('.stack-row[data-ink="Y"] input[type=checkbox]');
    const chipOn = await page.isChecked('.view-bar label.chip:has-text("Yellow") input');
    check(!chipOn && (await page.textContent(".stats .big")) === stats && (await page.$('.lane-row[data-lane="Y"].hidden-lane')) !== null, "hiding Yellow in the Stack panel hides it on the canvas only (time estimate unchanged)");
    await page.check('.stack-row[data-ink="Y"] input[type=checkbox]');

    // One lane at a time, then all four again.
    await page.click('.lanes-bar [data-lane-tab="M"]');
    const one = await rows();
    await page.click('.lanes-bar [data-lane-tab="all"]');
    check(one === "M:pixelate+centerline" && (await page.$$(".lane-row")).length === 4, `the C/M/Y/K tabs show one lane, All lanes all four (${one})`);

    // The warning takes the focus; Escape closes it and gives the focus back to Linked.
    await page.click(".lanes-bar button:has-text('Linked')");
    const focusIn = await page.evaluate(() => document.activeElement?.closest(".link-warn") !== null && document.activeElement?.textContent);
    await page.keyboard.press("Escape");
    const back = await page.evaluate(() => ({ gone: !document.querySelector(".link-warn"), on: document.activeElement?.textContent }));
    check(/Link every ink/.test(focusIn || "") && back.gone && back.on === "Linked", `the link warning takes the focus, and Escape gives it back (${focusIn} → ${back.on})`);
    // Linked again: a warning first, then a checkpoint, then every ink copies the chosen lane.
    await page.click(".lanes-bar button:has-text('Linked')");
    const warn = await page.textContent(".link-warn");
    check(/will change/.test(warn) && /checkpoint first/.test(warn), `Linked warns what changes and that a checkpoint is saved first (${warn.slice(0, 80)}…)`);
    await page.click('.link-warn .link-warn-pick button:has-text("Magenta")');
    await page.click(".link-warn button:has-text('Link every ink to Magenta')");
    await page.waitForSelector(".lane-rows", { state: "detached", timeout: 30_000 });
    const keys = await page.$$eval(".strip .box", (els) => els.map((e) => e.dataset.key).join(","));
    const notices = await page.$$eval(".notice", (els) => els.map((e) => e.textContent).join(" "));
    check(keys === "source,cmyk,pixelate,centerline,@stack,order" && /every ink now uses the Magenta lane/.test(notices), `linking collapses every ink onto Magenta's lane (${keys})`);
    await page.click("header.top .cp-group button:has-text('Checkpoints')");
    const saved = await page.waitForSelector("text=Before linking the inks", { timeout: 10_000 }).catch(() => null);
    check(!!saved, "the independent inks were saved as a checkpoint before linking");
    await page.close();
  }

  // CMYK views (#79): Stacked / Four panels (at the split, a step and the stack), Show other
  // inks under one ink's step, and See-through / Opaque in the Stack panel (pass order shows).
  {
    const page = await open(1400);
    const canvas = "section.view svg.preview";
    check(!(await page.$(".view-bar .ink-view-bar")), "no Stacked / Four panels before the picture is split");
    await page.click('.strip .box[data-key="source"] .pic');
    await page.click("aside.side .split-card button:has-text('Split into CMYK')");
    await page.waitForSelector(".strip .box.lane.split", { timeout: 30_000 });
    await page.waitForSelector(".view-bar .ink-view-bar", { timeout: 10_000 });
    /** Each panel's ink, and the inks drawn in it. */
    const panels = () =>
      page.$$eval("svg.four-panels g.ink-panel", (els) => els.map((g) => `${g.dataset.panel}${g.dataset.hidden ? "(hidden)" : ""}:${[...new Set([...g.querySelectorAll("[data-ink]")].map((e) => e.dataset.ink))].join("")}`).join(" "));
    const viewing = () => page.textContent(".view-bar");
    await page.click('.strip .box[data-key="cmyk"] .pic');
    await page.click(".ink-view-bar button:has-text('Four panels')");
    await page.waitForSelector("svg.four-panels", { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelectorAll("svg.four-panels [data-ink]").length >= 4, null, { timeout: 30_000 }).catch(() => {});
    const atSplit = await panels();
    check(atSplit === "C:C M:M Y:Y K:K" && /each ink at the split/.test(await viewing()), `four panels at the split: C, M, Y, K side by side, each ink alone (${atSplit})`);
    await page.click('.strip .box[data-key="centerline"] .pic');
    await page.waitForFunction(() => /each ink after Centerline/.test(document.querySelector(".view-bar").textContent) && document.querySelector('svg.four-panels g[data-panel="C"] g[data-ink="C"]'), null, { timeout: 30_000 }).catch(() => {});
    const atStep = await panels();
    check(/^C:C M:M? Y:Y? K:K?$/.test(atStep) && (await page.$('svg.four-panels g[data-panel="C"] g[data-ink="C"]')) !== null && /each ink after Centerline/.test(await viewing()), `four panels at a step: each ink's lines after Centerline (${atStep})`);
    await page.click('.strip .box[data-key="@stack"] .pic');
    await page.waitForFunction(() => /each ink in the final stack/.test(document.querySelector(".view-bar").textContent), null, { timeout: 30_000 }).catch(() => {});
    const atStack = await panels();
    check(/^C:C M:M? Y:Y? K:K?$/.test(atStack) && /each ink in the final stack/.test(await viewing()), `four panels at the stack: each ink of the final plot (${atStack})`);
    // Preview as exported draws the page as one proof picture; four panels still show each ink's lines.
    await page.check(".stats label.toggle:has-text('Preview as exported') input");
    // The proof comes from a new run: wait for it to finish before looking.
    await page.waitForSelector(".stats .refining", { timeout: 5_000 }).catch(() => {});
    await page.waitForSelector(".stats .refining", { state: "detached", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const exported = await panels();
    check(/^C:C M:M? Y:Y? K:K?$/.test(exported) && (await page.$('svg.four-panels g[data-panel="C"] g[data-ink="C"] path')) !== null, `four panels at the stack keep the lines with Preview as exported on (${exported})`);
    await page.uncheck(".stats label.toggle:has-text('Preview as exported') input");
    await page.uncheck('.stack-row[data-ink="C"] input[type=checkbox]');
    const hiddenC = await panels();
    check(/^C\(hidden\): /.test(hiddenC), `an ink hidden in the Stack panel stays hidden in four panels (${hiddenC})`);
    await page.check('.stack-row[data-ink="C"] input[type=checkbox]');
    await page.click(".ink-view-bar button:has-text('Stacked')");
    await page.waitForSelector("svg.four-panels", { state: "detached", timeout: 10_000 });

    // See-through (multiply) vs opaque (normal, in pass order): the stack preview changes, and the order shows.
    const drawn = () => page.$$eval(`${canvas} g[data-ink]`, (els) => els.map((e) => `${e.dataset.ink}:${getComputedStyle(e).mixBlendMode}`));
    const stats = await page.textContent(".stats .big");
    const seeThrough = await drawn();
    const shotSee = await page.locator(canvas).screenshot();
    await page.click(".stack-mix button:has-text('Opaque')");
    await page.waitForFunction((c) => [...document.querySelectorAll(`${c} g[data-ink]`)].every((e) => getComputedStyle(e).mixBlendMode === "normal"), canvas, { timeout: 10_000 }).catch(() => {});
    const opaque = await drawn();
    const passOrder = () => page.$$eval(".stack-row", (els) => els.map((e) => e.dataset.ink).join(""));
    const order = await passOrder();
    const drawnOrder = opaque.map((d) => d.split(":")[0]).join("");
    const shotOpaque = await page.locator(canvas).screenshot();
    check((await page.textContent(".stats .big")) === stats, `See-through / Opaque is only the preview: the plot's time is unchanged (${stats})`);
    check(seeThrough.length >= 2 && seeThrough.every((d) => d.endsWith(":multiply")) && opaque.every((d) => d.endsWith(":normal")) && !shotSee.equals(shotOpaque), `See-through multiplies, Opaque draws in pass order with normal blending (${seeThrough.join(",")} → ${opaque.join(",")}; pass order ${order})`);
    check(drawnOrder === order.split("").filter((id) => drawnOrder.includes(id)).join(""), `opaque inks are drawn in the pass order (${drawnOrder} in ${order})`);
    // Opaque: changing the pass order changes the picture.
    const first = order[0];
    await page.click(`.stack-row[data-ink="${first}"] button[aria-label^="Plot"][aria-label$="later"]`);
    await page.waitForFunction((o) => [...document.querySelectorAll(".stack-row")].map((e) => e.dataset.ink).join("") !== o, order, { timeout: 30_000 }).catch(() => {});
    await page.waitForFunction(([c, o]) => [...document.querySelectorAll(`${c} g[data-ink]`)].map((e) => e.dataset.ink).join("") !== o, [canvas, drawnOrder], { timeout: 30_000 }).catch(() => {});
    const reordered = (await drawn()).map((d) => d.split(":")[0]).join("");
    const shotMoved = await page.locator(canvas).screenshot();
    check(reordered !== drawnOrder && !shotMoved.equals(shotOpaque), `with opaque inks the pass order changes the picture (${drawnOrder} → ${reordered})`);
    await page.click(".stack-mix button:has-text('See-through')");

    // Show other inks: one ink's step (an independent lane) with the other inks faint underneath.
    await page.click(".lanes-bar button:has-text('Independent')");
    await page.waitForSelector(".lane-rows", { timeout: 10_000 });
    await page.click('.box[data-key="centerline@C"] .pick');
    await page.waitForSelector(".ink-view-bar button:has-text('Show other inks')", { timeout: 10_000 });
    const faint = () => page.$$eval(`${canvas} [data-ink]`, (els) => els.map((e) => `${e.dataset.ink}${e.dataset.faint ? "~" : ""}`).join(","));
    await page.waitForFunction((c) => document.querySelector(`${c} [data-faint]`), canvas, { timeout: 30_000 }).catch(() => {});
    const withOthers = await faint();
    const pressed = await page.getAttribute(".ink-view-bar button:has-text('Show other inks')", "aria-pressed");
    await page.click(".ink-view-bar button:has-text('Show other inks')");
    const alone = await faint();
    check(pressed === "true" && /~/.test(withOthers) && /C$/.test(withOthers) && alone === "C", `Show other inks: the other inks faintly under Cyan's step, or Cyan alone (${withOthers} → ${alone})`);
    await page.close();
  }

  // Final review (#77–#79): after Independent, the selected step's slider still changes the
  // plot (the selection moves into a lane); Applies to can't break a lane; Settings for one ink
  // in a linked split says the inks are now independent.
  {
    const page = await open(1400);
    const strokes = () => page.textContent(".stats").then((t) => /([\d,]+) strokes/.exec(t)?.[1]);
    await page.click('.strip .box[data-key="source"] .pic');
    await page.click("aside.side .split-card button:has-text('Split into CMYK')");
    await page.waitForSelector(".strip .box.lane.split", { timeout: 30_000 });
    await page.click('.strip .box[data-key="centerline"] .pick');
    await page.click(".lanes-bar button:has-text('Independent')");
    await page.waitForSelector(".lane-rows", { timeout: 10_000 });
    await page.waitForSelector(".stats .big", { timeout: 60_000 });
    // Settled: the run after Independent is done (same lines: unlinking changes nothing).
    await page.waitForFunction(() => !document.querySelector(".stats .refining"), null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const picked = await page.$$eval(".lane-rows .box.sel", (els) => els.map((e) => e.dataset.key));
    const before = await strokes();
    const slider = page.locator('aside.side .card.step.focus .param:has(label:has-text("Minimum length")) input[type=range]');
    await slider.focus();
    await page.keyboard.press("End");
    await page.waitForFunction((b) => /([\d,]+) strokes/.exec(document.querySelector(".stats")?.textContent ?? "")?.[1] !== b, before, { timeout: 30_000 }).catch(() => {});
    const after = await strokes();
    check(picked.length === 1 && /^centerline@/.test(picked[0]) && after !== before, `after Independent the selected step is picked in a lane (${picked}) and its slider changes the plot (${before} → ${after} strokes)`);
    await page.close();
  }
  {
    const page = await open(1400);
    const recipe = {
      schemaVersion: 4,
      input: "image",
      paper: { widthMm: 297, heightMm: 210 },
      inks: [{ id: "k", color: "#000" }],
      steps: [{ step: "cmyk" }, { step: "levels", params: { count: 3 } }, { step: "bands" }, { step: "fill" }, { step: "order" }],
    };
    await page.setInputFiles("aside.side input[type=file]", { name: "linked-cmyk.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(recipe)) });
    await page.waitForSelector('.strip .box[data-key="bands"]', { timeout: 30_000 });
    await page.click('.strip .box[data-key="bands"] .pick');
    const cyan = page.locator('aside.side .card.step.focus .scope-row:has(.scope-label:has-text("Applies to")) label.chip:has-text("Cyan") input');
    await cyan.waitFor({ timeout: 60_000 });
    await cyan.uncheck({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    const notices = await page.$$eval(".notice", (els) => els.map((e) => e.textContent).join(" "));
    check((await cyan.isChecked()) && /Fill works on C's lines/.test(notices) && /Linked/.test(await page.textContent(".lanes-bar .seg button[aria-pressed=true]")), `unticking Cyan in Applies to on a linked split is refused with the reason (${notices.slice(0, 90)}…)`);
    await page.click('.strip .box[data-key="levels"] .pick');
    await page.click('aside.side .card.step.focus .scope-row:has(.scope-label:has-text("Settings for")) button:has-text("Magenta")');
    const count = page.locator('aside.side .card.step.focus .param:has(label:has-text("Bands")) input[type=range]').first();
    await count.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => /Magenta now has its own/.test([...document.querySelectorAll(".notice")].map((e) => e.textContent).join(" ")), null, { timeout: 10_000 }).catch(() => {});
    const said = await page.$$eval(".notice", (els) => els.map((e) => e.textContent).join(" "));
    check(/Independent: Magenta now has its own steps or settings/.test(said), `Settings for one ink in a linked split says the inks are now independent`);
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
