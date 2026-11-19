import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRecipe, type Recipe } from "@plotlab/engine";
import { applyPreset, createRegistry, presets, presetSteps } from "../src/index.ts";

const casesDir = new URL("../../../golden/cases/", import.meta.url);
const goldenPresets = readdirSync(casesDir)
  .filter((f) => f.endsWith(".recipe.json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, casesDir), "utf8")).preset as string | undefined);

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
  }
  it("presetSteps returns a fresh copy", () => {
    const a = presetSteps("topo-hatch");
    a[0]!.params.contrast = 99;
    expect(presetSteps("topo-hatch")[0]!.params.contrast).not.toBe(99);
  });
  describe("applyPreset", () => {
    const base = (target: unknown): Recipe =>
      loadRecipe({ schemaVersion: 2, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], target, steps: presetSteps("centerline") }, createRegistry()).recipe;
    it("replaces the steps and leaves the target alone when the preset has none", () => {
      const r = base({ kind: "raster", dpi: 150 });
      const out = applyPreset(r, "topo-hatch");
      expect(out.steps).toEqual(presetSteps("topo-hatch"));
      expect(out.target).toEqual({ kind: "raster", dpi: 150 });
    });
    it("switches the target like the Output panel, keeping mirror, registration and the 600 dpi floor", () => {
      const out = applyPreset(base({ kind: "plotter", mirror: true, registration: true }), "atkinson-print");
      expect(out.steps).toEqual(presetSteps("atkinson-print"));
      expect(out.target).toEqual({ kind: "print", dpi: 600, mode: "bitmap", halftone: null, negative: false, mirror: true, registration: true });
    });
    it("overrides the preset's print look but keeps the rest of the current print settings", () => {
      const out = applyPreset(base({ kind: "print", dpi: 1200, mode: "gray", halftone: { lpi: 30 }, negative: true }), "atkinson-print");
      expect(out.target).toEqual({ kind: "print", dpi: 1200, mode: "bitmap", halftone: null, negative: true });
    });
  });
});
