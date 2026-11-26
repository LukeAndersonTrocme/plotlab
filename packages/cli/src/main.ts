import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { describeEntry, enterAt, exportFormats, exportOutput, loadRecipe, Pipeline, RecipeError, showsTime, sourceLabel, sourceStage, StepError, type ExportFormat, type StepDefinition } from "@plotlab/engine";
import { budgetCheck, estimatePlot, getMachine } from "@plotlab/machines";
import { resolveBudget } from "./budget.ts";
import { createRegistry } from "@plotlab/steps";
import { expandInput, INPUT_FORMATS, readSource } from "./io.ts";

const USAGE = `plotlab: image → plotter / digital / print pipeline

Usage:
  plotlab run <recipe.json> -i <input|'frames/*.png'> -o <out-dir> [-f svg|pdf|png|tiff|plates] [--budget <min>]

  -f picks the file type; the default is the recipe target's main one
  (plotter: svg, vector: svg, raster: png, print: plates = one TIFF per ink + proof).
  --budget sets a time budget in minutes for this run (plotter targets), overriding the recipe's.

  Inputs: ${INPUT_FORMATS}. PNG, JPEG, WebP and single-page TIFF (8/16-bit) enter as an
  image; a multi-page TIFF enters as layers (one per page, separations); SVG enters as
  lines. Steps that belong before the entry stage are switched off, with a warning.

  plotlab steps list
  plotlab steps describe <step>
`;

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return m ? `${m} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;
};

function describe(def: StepDefinition): string {
  const perLayer = def.runLayer ? `, per layer (${(def.accepts ?? ["tone", "categories"]).join(" or ")})` : "";
  const lines = [`${def.id} (v${def.version}${def.experimental ? ", experimental" : ""}): ${def.title}`, `  ${def.summary}`, `  ${def.input} → ${def.output}, ${def.cost}${perLayer}`, "", "Parameters:"];
  if (def.runLayer) lines.splice(3, 0, `  In a recipe: "layers": ["id", …] picks layers; "layerParams": { "id": { … } } overrides settings per layer.`);
  for (const [k, d] of Object.entries(def.params)) {
    let range = "";
    if (d.type === "number") range = `${d.seed ? "seed " : ""}${d.min}..${d.max}${d.unit ? ` ${d.unit}` : ""}`;
    if (d.type === "enum") range = d.options.map((o) => o.value).join(" | ");
    if (d.type === "boolean") range = "true | false";
    if (d.type === "text") range = "text";
    if (d.type === "table") range = `{ "<${d.rowLabel.toLowerCase()}>": { ${Object.keys(d.columns).join(", ")} } }`;
    const cond = d.visibleWhen ? `  (only when ${d.visibleWhen.param} = ${d.visibleWhen.equals.join("/")})` : "";
    lines.push(`  ${k}  [${range}]  default ${JSON.stringify(d.default)}${cond}`, `      ${d.help}`);
  }
  return lines.join("\n");
}

async function run(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { input: { type: "string", short: "i" }, out: { type: "string", short: "o" }, format: { type: "string", short: "f" }, budget: { type: "string" } },
  });
  const recipePath = positionals[0];
  if (!recipePath || !values.input || !values.out) {
    process.stderr.write(USAGE);
    return 2;
  }
  const registry = createRegistry();
  const { recipe, warnings } = loadRecipe(JSON.parse(readFileSync(recipePath, "utf8")), registry);
  for (const w of warnings) process.stderr.write(`warning: ${w.index >= 0 ? `step ${w.index}: ` : ""}${w.message}\n`);
  const budgetMin = resolveBudget(values.budget, recipe.target, (m) => process.stderr.write(`warning: ${m}\n`));
  const formats: ExportFormat[] = ["svg", "pdf", "png", "tiff", "plates"];
  const format = (values.format ?? exportFormats(recipe.target)[0]) as ExportFormat;
  if (!formats.includes(format)) throw new Error(`unknown format "${values.format}"; use one of ${formats.join(", ")}`);
  const inputs = expandInput(values.input);
  if (inputs.length === 0) throw new Error(`no files match ${values.input}`);
  const outDir = values.out;
  mkdirSync(outDir, { recursive: true });
  const pipeline = new Pipeline(registry);
  let ran = recipe;
  for (const file of inputs) {
    pipeline.reset();
    const source = readSource(file, (m) => process.stderr.write(`warning: ${m}\n`));
    const stage = sourceStage(source);
    const entry = enterAt(recipe, stage, registry);
    const note = describeEntry(sourceLabel(basename(file), source), stage, entry);
    if (entry.issues.length) throw new Error(note!);
    if (note) process.stderr.write(`warning: ${note}\n`);
    ran = entry.recipe;
    const { output, plot, results, warnings: runWarnings } = await pipeline.run(source, ran, { sourceKey: file });
    for (const w of runWarnings) process.stderr.write(`warning: ${w}\n`);
    for (const r of results) {
      const title = registry.get(r.step)?.title ?? r.step;
      for (const w of r.warnings) {
        // Name the layer only when the step made more than one, so one-layer output reads plainly.
        const layer = w.layer !== undefined && r.layers.length > 1 ? ` (${r.layers.find((l) => l.id === w.layer)?.name ?? w.layer})` : "";
        process.stderr.write(`warning: ${title}${layer}: ${w.message}\n`);
      }
    }
    const lineFormat = format === "svg" || format === "pdf";
    if (!plot && lineFormat && ran.target.kind === "plotter") throw new Error(`recipe ends at ${output.kind}; add a step that makes lines (e.g. centerline) to export for a plotter`);
    const stem = inputs.length > 1 ? basename(file, extname(file)) : "plot";
    const { files, notes } = exportOutput(output, plot, ran, format, stem);
    for (const f of files) writeFileSync(join(outDir, f.name), f.data);
    let line = files.map((f) => join(outDir, f.name)).join(", ");
    if (plot) {
      const strokes = plot.layers.reduce((n, l) => n + l.paths.length, 0);
      line += `  ${strokes} strokes`;
      if (showsTime(ran.target)) {
        const e = estimatePlot(plot, getMachine(ran.machine));
        line += `  ~${fmtTime(e.totalS)}${plot.ordered ? "" : " (traced order)"}`;
        if (budgetMin !== undefined) {
          const b = budgetCheck(e, budgetMin);
          line += `  ${b.over ? "OVER BUDGET: " : ""}${b.message}`;
        }
      }
    }
    process.stdout.write(line + "\n");
    for (const n of notes) process.stderr.write(`note: ${n}\n`);
  }
  // The recipe that ran (for mixed inputs, the last file's entry stage).
  writeFileSync(join(outDir, "recipe.json"), JSON.stringify(ran, null, 2) + "\n");
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "run") return run(argv.slice(1));
  if (cmd === "steps" && sub === "list") {
    for (const s of createRegistry().list()) process.stdout.write(`${s.id.padEnd(12)} ${s.input} → ${s.output}  ${s.experimental ? "[experimental] " : ""}${s.summary}\n`);
    return 0;
  }
  if (cmd === "steps" && sub === "describe" && rest[0]) {
    const def = createRegistry().get(rest[0]);
    if (!def) {
      process.stderr.write(`unknown step "${rest[0]}"\n`);
      return 1;
    }
    process.stdout.write(describe(def) + "\n");
    return 0;
  }
  process.stdout.write(USAGE);
  return !cmd || cmd === "--help" || cmd === "-h" || cmd === "help" ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`error: ${e instanceof StepError ? `step ${e.index}: ${e.message}` : e instanceof RecipeError ? e.message : e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
