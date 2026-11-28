// Takes the manual's screenshots (docs/manual/img/*.png) from the live site or a production
// build, and writes an accessibility snapshot of each screen next to them in --aria <dir>, to
// check the manual's labels against. Run by hand before a release, never against `vite dev`:
//
//   node packages/web/scripts/manual-shots.mjs [--url https://lukeandersontrocme.github.io/plotlab/] [--aria /tmp/aria]
//
// For a local production build: `BASE=/plotlab/ pnpm build && pnpm --filter @plotlab/web preview`
// and pass the preview URL.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const url = opt("--url", "https://lukeandersontrocme.github.io/plotlab/");
const img = join(root, "docs/manual/img");
const aria = opt("--aria", null);
mkdirSync(img, { recursive: true });
if (aria) mkdirSync(aria, { recursive: true });

const browser = await chromium.launch();
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await desk.newPage();
async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(img, `${name}.png`) });
  if (aria) writeFileSync(join(aria, `${name}.txt`), await page.locator("body").ariaSnapshot());
  console.log(`shot: ${name}`);
}
async function snap(page, name) {
  await page.waitForTimeout(800);
  if (aria) writeFileSync(join(aria, `${name}.txt`), await page.locator("body").ariaSnapshot());
}

await p.goto(url);
await p.waitForSelector(".stats .big", { timeout: 90000 });
await shot(p, "design");
const mode = (m) => p.getByRole("navigation", { name: "Mode" }).getByRole("button", { name: m });
await mode("Page").click();
await shot(p, "page");
await mode("Plot").click();
await shot(p, "plot");
await mode("Design").click();

// Labels only (no image): compare stages, the add menu, a step card, checkpoints.
await p.getByRole("button", { name: "Compare stages" }).click();
await snap(p, "x-compare");
await p.getByRole("button", { name: "Compare stages" }).click();
await p.getByRole("button", { name: /^Add a step after/ }).first().click();
await snap(p, "x-addmenu");
await p.keyboard.press("Escape");
await p.getByRole("banner").getByRole("button", { name: "Checkpoints", exact: true }).click();
await snap(p, "x-checkpoints");
await p.getByRole("banner").getByRole("button", { name: "Checkpoints", exact: true }).click();

// Four inks, Independent lanes, four panels.
await p.getByRole("button", { name: "Presets", exact: true }).click();
await p.getByRole("button", { name: /CMYK print/ }).first().click();
await p.waitForSelector(".stats .big", { timeout: 90000 });
await snap(p, "x-cmyk-linked");
await p.getByRole("button", { name: "Independent", exact: true }).click();
await p.waitForTimeout(500);
const confirm = p.getByRole("button", { name: /^(Make independent|Independent|OK|Continue)$/ });
if (await confirm.count() > 1) await confirm.last().click();
await p.getByRole("button", { name: "Four panels" }).click().catch(() => {});
await p.getByRole("button", { name: "Stack" }).first().click().catch(() => {});
await shot(p, "cmyk-lanes");

// Phone viewer.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const pp = await phone.newPage();
await pp.goto(url);
await pp.waitForTimeout(4000);
await snap(pp, "x-phone-list");
await pp.getByRole("button", { name: /Sample/ }).first().click();
await shot(pp, "phone");
await browser.close();
