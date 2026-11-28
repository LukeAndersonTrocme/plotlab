// Builds the user manual from docs/manual/<lang>/*.md into one HTML page (pandoc, numbered
// sections) and a PDF of the same page with page numbers (Playwright's Chromium).
// The step reference comes from packages/steps/src/<id>/help.md and the preset list from
// packages/steps/src/presets.ts, so the manual and the in-app help can't disagree.
//
//   node packages/web/scripts/manual.mjs [--out <dir>] [--lang en] [--no-pdf]
//
// Default output: packages/web/dist/manual/ (index.html + plotlab-manual-v<version>.pdf).
// Needs pandoc on PATH; the PDF needs `playwright install chromium`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const lang = opt("--lang", "en");
const out = resolve(opt("--out", join(root, "packages/web/dist/manual")));
const manual = join(root, "docs/manual");
const stepsSrc = join(root, "packages/steps/src");
const version = readFileSync(join(manual, "VERSION"), "utf8").trim();

/** Step ids in the order the registry (and the + menu) lists them. */
export function stepOrder(indexTs) {
  const m = indexTs.match(/allSteps\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error("manual: can't find allSteps in packages/steps/src/index.ts");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** One step's help.md, shifted under "## Steps" and without unwritten placeholders. */
export function stepSection(md, experimental) {
  const paras = md.trim().split(/\n\s*\n/);
  const kept = paras.filter((p) => !/^\*\*Analog history:\*\*[\s\S]*\*To be written/.test(p));
  let [head, ...rest] = kept;
  head = head.replace(/^#\s+/, "### ");
  if (experimental && !/experimental/i.test(head)) head += " (experimental)";
  return [head, ...rest].join("\n\n");
}

export function stepsReference() {
  const order = stepOrder(readFileSync(join(stepsSrc, "index.ts"), "utf8"));
  const dirs = new Map();
  for (const d of readdirSync(stepsSrc, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const idx = join(stepsSrc, d.name, "index.ts");
    if (!existsSync(idx)) continue;
    const m = readFileSync(idx, "utf8").match(/export const (\w+)\s*=\s*defineStep/);
    if (m) dirs.set(m[1], d.name);
  }
  return order
    .map((name) => {
      const dir = dirs.get(name);
      if (!dir) throw new Error(`manual: no folder for step ${name}`);
      const idx = readFileSync(join(stepsSrc, dir, "index.ts"), "utf8");
      return stepSection(readFileSync(join(stepsSrc, dir, "help.md"), "utf8"), /experimental:\s*true/.test(idx));
    })
    .join("\n\n");
}

export function presetsReference() {
  const src = readFileSync(join(stepsSrc, "presets.ts"), "utf8");
  const rows = [...src.matchAll(/title:\s*"([^"]+)",\s*summary:\s*"([^"]+)"/g)];
  if (rows.length === 0) throw new Error("manual: no presets found in presets.ts");
  return ["| Preset | What it makes |", "|---|---|", ...rows.map(([, t, s]) => `| **${t}** | ${s} |`)].join("\n");
}

function build() {
  const dir = join(manual, lang);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  let md = files.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n");
  md = md.replace("<!-- GENERATED:steps -->", stepsReference()).replace("<!-- GENERATED:presets -->", presetsReference());
  mkdirSync(out, { recursive: true });
  const combined = join(out, `manual.${lang}.md`);
  writeFileSync(combined, md);
  const html = join(out, "index.html");
  execFileSync(
    "pandoc",
    [combined, "-o", html, "--standalone", "--embed-resources", "--toc", "--toc-depth=2", "--number-sections",
     `--resource-path=${dir}:${manual}`, `--css=${join(manual, "manual.css")}`, `--include-after-body=${join(manual, "manual.js.html")}`,
     "-M", `subtitle=Version ${version}, for plotlab ${version}`, "-M", `version=${version}`],
    { stdio: "inherit" },
  );
  console.log(`manual: ${html}`);
  return html;
}

async function pdf(html) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href);
  // The web page folds the contents on narrow screens; the PDF always shows them.
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  const file = join(out, `plotlab-manual-v${version}.pdf`);
  await page.pdf({
    path: file,
    format: "A4",
    margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font: 8pt sans-serif; color: #666; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;"><span>plotlab manual v${version}</span><span>page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    printBackground: true,
  });
  await browser.close();
  console.log(`manual: ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const html = build();
  if (!args.includes("--no-pdf")) await pdf(html);
}
