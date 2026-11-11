/**
 * Golden tests: each golden/cases/*.recipe.json runs on its fixture and the SVG is compared
 * to golden/approved/<case>.svg. To approve new output: `pnpm golden:approve`, then review
 * the diff in git like any other change. The approved SVGs double as an example gallery.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRecipe, Pipeline, plotToSvg, type Plot } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
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
      const { fixture, ...recipeJson } = raw;
      const { recipe } = loadRecipe(recipeJson, registry);
      const { output } = await new Pipeline(registry).run(readImage(join(root, "fixtures", fixture)), recipe);
      const svg = plotToSvg(output as Plot, { recipe });
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
