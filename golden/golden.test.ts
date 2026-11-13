/**
 * Golden tests: each golden/cases/*.recipe.json runs on its fixture and the SVG is compared
 * to golden/approved/<case>.svg. To approve new output: `pnpm golden:approve`, then review
 * the diff in git like any other change. The approved files double as an example gallery.
 *
 * A case with `"export": "png"` (or "plates", which checks the print proof) is a raster
 * golden: pixels are compared with a small tolerance (anti-aliasing and float rounding may
 * differ across machines) and a failing run writes golden/received/<case>.diff.png.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportOutput, loadRecipe, Pipeline, plotToSvg, type ExportFormat } from "@plotlab/engine";
import { PNG } from "pngjs";
import { createRegistry, presetSteps } from "@plotlab/steps";
import { readImage } from "../packages/cli/src/io.ts";

const root = dirname(fileURLToPath(import.meta.url));
const update = process.env.UPDATE_GOLDEN === "1";
const cases = readdirSync(join(root, "cases")).filter((f) => f.endsWith(".recipe.json"));

describe("golden", () => {
  for (const file of cases) {
    const name = file.replace(/\.recipe\.json$/, "");
    it(name, async () => {
      const raw = JSON.parse(readFileSync(join(root, "cases", file), "utf8"));
      const registry = createRegistry();
      // A case may name a preset instead of listing steps; the golden then proves the preset.
      const { fixture, preset, export: format, ...recipeJson } = raw;
      if (preset) recipeJson.steps = presetSteps(preset);
      const { recipe } = loadRecipe(recipeJson, registry);
      const { plot, output } = await new Pipeline(registry).run(readImage(join(root, "fixtures", fixture)), recipe);
      if (format) return rasterGolden(name, exportOutput(output, plot, recipe, format as ExportFormat, name).files.find((f) => f.name.endsWith(".png"))!.data as Uint8Array);
      if (!plot) throw new Error(`${name} does not end in lines`);
      const svg = plotToSvg(plot, { recipe });
      const approved = join(root, "approved", `${name}.svg`);
      if (update || !existsSync(approved)) {
        if (!update) throw new Error(`no approved output for ${name}; run pnpm golden:approve and review it`);
        writeFileSync(approved, svg);
        return;
      }
      const expected = readFileSync(approved, "utf8");
      if (svg !== expected) {
        mkdirSync(join(root, "received"), { recursive: true });
        writeFileSync(join(root, "received", `${name}.svg`), svg);
      }
      expect(svg, `output changed; see golden/received/${name}.svg`).toBe(expected);
    });
  }
});

/** Per-channel difference that counts as a changed pixel, and the share of pixels allowed to change. */
const CHANNEL_TOLERANCE = 8;
const PIXEL_TOLERANCE = 0.001;

function rasterGolden(name: string, png: Uint8Array): void {
  const approved = join(root, "approved", `${name}.png`);
  if (update || !existsSync(approved)) {
    if (!update) throw new Error(`no approved output for ${name}; run pnpm golden:approve and review it`);
    writeFileSync(approved, png);
    return;
  }
  const got = PNG.sync.read(Buffer.from(png));
  const want = PNG.sync.read(readFileSync(approved));
  expect([got.width, got.height], `${name}: size changed`).toEqual([want.width, want.height]);
  const diff = new PNG({ width: got.width, height: got.height });
  let changed = 0;
  for (let i = 0; i < got.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(got.data[i + k]! - want.data[i + k]!));
    const bad = d > CHANNEL_TOLERANCE;
    if (bad) changed++;
    // Changed pixels in red over a faded copy of the approved image.
    const g = Math.round(want.data[i]! * 0.3 + 178);
    diff.data.set(bad ? [255, 0, 0, 255] : [g, g, g, 255], i);
  }
  const share = changed / (got.width * got.height);
  if (share > PIXEL_TOLERANCE) {
    mkdirSync(join(root, "received"), { recursive: true });
    writeFileSync(join(root, "received", `${name}.png`), png);
    writeFileSync(join(root, "received", `${name}.diff.png`), PNG.sync.write(diff));
  }
  expect(share, `${(share * 100).toFixed(2)}% of pixels changed; see golden/received/${name}.diff.png`).toBeLessThanOrEqual(PIXEL_TOLERANCE);
}
