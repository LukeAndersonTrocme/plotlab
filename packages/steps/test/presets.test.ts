import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRecipe } from "@plotlab/engine";
import { createRegistry, presets, presetSteps } from "../src/index.ts";

const casesDir = new URL("../../../golden/cases/", import.meta.url);
const goldenCases = readdirSync(casesDir)
  .filter((f) => f.endsWith(".recipe.json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, casesDir), "utf8")) as { preset?: string; target?: { kind: string } });
const goldenPresets = goldenCases.map((c) => c.preset);

describe("presets", () => {
  for (const p of presets) {
    it(`${p.id} loads cleanly`, () => {
      const { warnings } = loadRecipe(
        { schemaVersion: 2, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: presetSteps(p.id) },
        createRegistry(),
      );
      expect(warnings).toEqual([]);
    });
    it(`${p.id} is proven by a golden case`, () => expect(goldenPresets).toContain(p.id));
    if (p.target) {
      it(`${p.id}'s golden case uses its ${p.target.kind} target`, () => {
        const kinds = goldenCases.filter((c) => c.preset === p.id).map((c) => c.target?.kind ?? "plotter");
        expect(kinds).toContain(p.target!.kind);
      });
    }
  }
  it("presetSteps returns a fresh copy", () => {
    const a = presetSteps("topo-hatch");
    a[0]!.params.contrast = 99;
    expect(presetSteps("topo-hatch")[0]!.params.contrast).not.toBe(99);
  });
});
