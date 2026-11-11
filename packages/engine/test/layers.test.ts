import { describe, expect, it } from "vitest";
import { defineStep, loadRecipe, Pipeline, StepError, StepRegistry, type Layer, type Layers, type RawImage } from "../src/index.ts";
import { centerline, threshold } from "../../steps/src/index.ts";

/** Test-only: splits the image into two identical tone layers "a" and "b". */
const split = defineStep({
  id: "split", version: 1, title: "Split", summary: "", input: "image", output: "layers", cost: "live", help: "", params: {},
  run: (img): Layers => {
    const data = new Float32Array(img.width * img.height).map((_, i) => (img.data[i * img.channels]! < 0.5 ? 1 : 0));
    const layer = (id: string): Layer => ({ id, name: id.toUpperCase(), values: { kind: "tone", data: data.slice() } });
    return { kind: "layers", width: img.width, height: img.height, frame: img.frame, layers: [layer("a"), layer("b")] };
  },
});
/** Test-only: blends each tone toward its inverse by `amount`. */
const invert = defineStep({
  id: "invert", version: 1, title: "Invert", summary: "", input: "layers", output: "layers", cost: "live", help: "",
  params: { amount: { type: "number", label: "Amount", help: "", min: 0, max: 1, default: 1 } },
  accepts: ["tone"],
  runLayer: (l, p): Layer => {
    if (l.values.kind !== "tone") throw new Error("unreachable");
    return { ...l, values: { kind: "tone", data: l.values.data.map((v) => p.amount * (1 - v) + (1 - p.amount) * v) } };
  },
});
/** Test-only: tone → 2 categories. */
const fakeLevels = defineStep({
  id: "fake-levels", version: 1, title: "Fake levels", summary: "", input: "layers", output: "layers", cost: "live", help: "", params: {},
  accepts: ["tone"],
  runLayer: (l): Layer => {
    if (l.values.kind !== "tone") throw new Error("unreachable");
    return { ...l, values: { kind: "categories", count: 2, data: Uint16Array.from(l.values.data, (v) => (v < 0.5 ? 1 : 2)) } };
  },
});

const reg = new StepRegistry([split, invert, fakeLevels, threshold, centerline]);
// 8×8 source: left half black, right half white.
const src: RawImage = { width: 8, height: 8, channels: 1, data: new Float32Array(64).map((_, i) => (i % 8 < 4 ? 0 : 1)) };
const run = (steps: unknown[]) =>
  new Pipeline(reg).run(
    src,
    loadRecipe({ schemaVersion: 2, paper: { widthMm: 8, heightMm: 8 }, layout: { marginMm: 0 }, workingMmPerPx: 1, inks: [{ id: "k", color: "#000" }], steps }, reg).recipe,
  );
const tone = (l: Layer | undefined) => (l?.values.kind === "tone" ? [...l.values.data] : null);

describe("layer selection", () => {
  it("transforms only the selected layers and passes the rest through untouched", async () => {
    const { output, results } = await run([{ step: "split" }, { step: "invert", layers: ["b"] }]);
    const out = output as Layers;
    const before = results[0]!.output as Layers;
    expect(tone(out.layers[0])).toEqual(tone(before.layers[0]));
    expect(out.layers[0]).toBe(before.layers[0]);
    expect(tone(out.layers[1])![0]).toBe(0);
    expect(tone(out.layers[1])![7]).toBe(1);
  });
  it("applies per-layer settings only to that layer", async () => {
    const { output } = await run([{ step: "split" }, { step: "invert", params: { amount: 1 }, layerParams: { b: { amount: 0 } } }]);
    const out = output as Layers;
    expect(tone(out.layers[0])![0]).toBe(0); // a inverted
    expect(tone(out.layers[1])![0]).toBe(1); // b untouched
  });
  it("clamps invalid per-layer settings with a warning", () => {
    const { recipe, warnings } = loadRecipe(
      { schemaVersion: 2, paper: { widthMm: 8, heightMm: 8 }, inks: [{ id: "k", color: "#000" }], steps: [{ step: "split" }, { step: "invert", layerParams: { b: { amount: 5 } } }] },
      reg,
    );
    expect(recipe.steps[1]!.layerParams).toEqual({ b: { amount: 1 } });
    expect(warnings.map((w) => w.message).join()).toMatch(/amount \(layer "b"\)/);
  });
  it("reports each step's output layers for the UI", async () => {
    const { results } = await run([{ step: "split" }, { step: "fake-levels", layers: ["a"] }, { step: "centerline", layers: ["b"] }]);
    expect(results[1]!.layers).toEqual([
      { id: "a", name: "A", kind: "categories" },
      { id: "b", name: "B", kind: "tone" },
    ]);
    expect(results[2]!.layers).toEqual([
      { id: "b", name: "B", kind: "lines" },
      { id: "a", name: "A", kind: "categories" },
    ]);
  });
});

describe("value kinds", () => {
  it("explains when a step gets the wrong kind of layer", async () => {
    const err = await run([{ step: "split" }, { step: "fake-levels" }, { step: "centerline" }]).catch((e) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err.index).toBe(2);
    expect(err.message).toMatch(/Centerline traces tone layers, but "A" holds categories/);
  });
});

describe("layers that stop early", () => {
  it("unselected layers ride along as raster layers when others become lines", async () => {
    const { output, plot } = await run([{ step: "split" }, { step: "centerline", layers: ["a"], params: { minLength: 0 } }]);
    expect(output.kind).toBe("geometry");
    if (output.kind !== "geometry") return;
    expect(output.layers.map((l) => l.id)).toEqual(["a"]);
    expect(output.rasterLayers?.layers.map((l) => l.id)).toEqual(["b"]);
    expect(plot?.rasterLayers?.layers.map((l) => l.id)).toEqual(["b"]);
  });
  it("a recipe ending at layers has no plot; selecting nothing gives an empty plot", async () => {
    expect((await run([{ step: "threshold" }])).plot).toBeNull();
    const { plot } = await run([{ step: "split" }, { step: "centerline", layers: [] }]);
    expect(plot?.layers).toEqual([]);
    expect(plot?.rasterLayers?.layers).toHaveLength(2);
  });
});
