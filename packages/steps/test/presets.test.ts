import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enterAt, lanesOf, loadRecipe, type Recipe } from "@plotlab/engine";
import { applyPreset, createRegistry, presets, presetSteps } from "../src/index.ts";

const casesDir = new URL("../../../golden/cases/", import.meta.url);
const goldenPresets = readdirSync(casesDir)
  .filter((f) => f.endsWith(".recipe.json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, casesDir), "utf8")).preset as string | undefined);

describe("presets", () => {
  for (const p of presets) {
    it(`${p.id} loads cleanly`, () => {
      const { warnings } = loadRecipe(
        { schemaVersion: 3, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: presetSteps(p.id) },
        createRegistry(),
      );
      expect(warnings).toEqual([]);
    });
    it(`${p.id} is proven by a golden case`, () => expect(goldenPresets).toContain(p.id));
  }
  it("every preset step has an id, unique within the preset", () => {
    for (const p of presets) {
      const ids = presetSteps(p.id).map((s) => s.id);
      expect(ids.every((id) => typeof id === "string" && id !== "")).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("presetSteps returns a fresh copy", () => {
    const a = presetSteps("topo-hatch");
    a[0]!.params.contrast = 99;
    expect(presetSteps("topo-hatch")[0]!.params.contrast).not.toBe(99);
  });
  describe("applyPreset", () => {
    const base = (target: unknown): Recipe =>
      loadRecipe({ schemaVersion: 3, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], target, steps: presetSteps("centerline") }, createRegistry()).recipe;
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
    it("CMYK print splits the picture into four inks, linked, with their inks and print screen angles on", () => {
      const out = applyPreset(base({ kind: "plotter" }), "cmyk-print");
      const v = lanesOf(out, createRegistry());
      expect(v.lanes.map((l) => l.layer)).toEqual(["C", "M", "Y", "K"]);
      expect(v.linked).toBe(true);
      expect(v.stack.map((i) => out.steps[i]!.step)).toEqual(["order"]);
      expect(out.layerInks).toEqual({ C: "cyan", M: "magenta", Y: "yellow", K: "black" });
      expect(out.inks.map((i) => i.id)).toEqual(["k", "cyan", "magenta", "yellow", "black"]);
      expect(out.screenAngles).toBe(true);
      // Other presets leave the switch and the inks as they were.
      const plain = applyPreset(base({ kind: "plotter" }), "topo-hatch");
      expect(plain.screenAngles).toBe(false);
      expect(plain.inks.map((i) => i.id)).toEqual(["k"]);
    });
    it("starts the chain at an image, so an SVG or separations source can switch steps off to fit", () => {
      const r = { ...base({ kind: "plotter" }), input: "geometry" as const };
      const out = applyPreset(r, "topo-hatch");
      expect(out.input).toBe("image");
      const fitted = enterAt(out, "geometry", createRegistry());
      expect(fitted.switchedOff.length).toBeGreaterThan(0);
      expect(fitted.issues).toEqual([]);
    });
  });
});
