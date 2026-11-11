import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { loadRecipe, Pipeline, plotToSvg, RecipeError, showsTime, StepError, type StepDefinition } from "@plotlab/engine";
import { estimatePlot, getMachine } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import { expandInput, readImage } from "./io.ts";

const USAGE = `plotlab: image → plotter pipeline

Usage:
  plotlab run <recipe.json> -i <input|'frames/*.png'> -o <out-dir>
  plotlab steps list
  plotlab steps describe <step>
`;

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return m ? `${m} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;
};

function describe(def: StepDefinition): string {
  const perLayer = def.runLayer ? `, per layer (${(def.accepts ?? ["tone", "categories"]).join(" or ")})` : "";
  const lines = [`${def.id} (v${def.version}): ${def.title}`, `  ${def.summary}`, `  ${def.input} → ${def.output}, ${def.cost}${perLayer}`, "", "Parameters:"];
  if (def.runLayer) lines.splice(3, 0, `  In a recipe: "layers": ["id", …] picks layers; "layerParams": { "id": { … } } overrides settings per layer.`);
  for (const [k, d] of Object.entries(def.params)) {
    let range = "";
    if (d.type === "number") range = `${d.seed ? "seed " : ""}${d.min}..${d.max}${d.unit ? ` ${d.unit}` : ""}`;
    if (d.type === "enum") range = d.options.map((o) => o.value).join(" | ");
    if (d.type === "boolean") range = "true | false";
    const cond = d.visibleWhen ? `  (only when ${d.visibleWhen.param} = ${d.visibleWhen.equals.join("/")})` : "";
    lines.push(`  ${k}  [${range}]  default ${JSON.stringify(d.default)}${cond}`, `      ${d.help}`);
  }
  return lines.join("\n");
}

async function run(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { input: { type: "string", short: "i" }, out: { type: "string", short: "o" } },
  });
  const recipePath = positionals[0];
  if (!recipePath || !values.input || !values.out) {
    process.stderr.write(USAGE);
    return 2;
  }
  const registry = createRegistry();
  const { recipe, warnings } = loadRecipe(JSON.parse(readFileSync(recipePath, "utf8")), registry);
  for (const w of warnings) process.stderr.write(`warning: ${w.index >= 0 ? `step ${w.index}: ` : ""}${w.message}\n`);
  const inputs = expandInput(values.input);
  if (inputs.length === 0) throw new Error(`no files match ${values.input}`);
  mkdirSync(values.out, { recursive: true });
  const pipeline = new Pipeline(registry);
  for (const file of inputs) {
    pipeline.reset();
    const { output, plot, warnings: runWarnings } = await pipeline.run(readImage(file), recipe, { sourceKey: file });
    for (const w of runWarnings) process.stderr.write(`warning: ${w}\n`);
    if (!plot) throw new Error(`recipe ends at ${output.kind}; add a step that makes lines (e.g. centerline) to export SVG`);
    const stem = inputs.length > 1 ? basename(file, extname(file)) : "plot";
    const svgPath = join(values.out, `${stem}.svg`);
    writeFileSync(svgPath, plotToSvg(plot, { recipe }));
    const strokes = plot.layers.reduce((n, l) => n + l.paths.length, 0);
    let line = `${svgPath}  ${strokes} strokes`;
    if (showsTime(recipe.target)) {
      const e = estimatePlot(plot, getMachine(recipe.machine));
      line += `  ~${fmtTime(e.totalS)}${plot.ordered ? "" : " (traced order)"}`;
    }
    const skipped = plot.rasterLayers?.layers.map((l) => l.name) ?? [];
    if (skipped.length) line += `  (not lines yet, skipped: ${skipped.join(", ")})`;
    process.stdout.write(line + "\n");
  }
  writeFileSync(join(values.out, "recipe.json"), JSON.stringify(recipe, null, 2) + "\n");
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "run") return run(argv.slice(1));
  if (cmd === "steps" && sub === "list") {
    for (const s of createRegistry().list()) process.stdout.write(`${s.id.padEnd(12)} ${s.input} → ${s.output}  ${s.summary}\n`);
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
  return cmd ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`error: ${e instanceof StepError ? `step ${e.index}: ${e.message}` : e instanceof RecipeError ? e.message : e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
