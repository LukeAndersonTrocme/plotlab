import { describe, expect, it } from "vitest";
import { defineStep, isChanged, loadRecipe, resetParam, resetStep, seedParam, StepRegistry, type ParamDecl, type Recipe, type RecipeStep } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
const level = reg.get("threshold")!.params.level as ParamDecl;
const recipe = (steps: Array<Record<string, unknown>>): Recipe =>
  loadRecipe({ schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps }, reg).recipe;

describe("isChanged", () => {
  it("marks a value that differs from the declared default", () => {
    expect(isChanged(level, 50)).toBe(false);
    expect(isChanged(level, 62)).toBe(true);
  });

  it("never marks a seed: it picks a variation, it isn't a setting", () => {
    expect(isChanged(seedParam(), 987654)).toBe(false);
  });

  it("compares tables by content", () => {
    const table: ParamDecl = { type: "table", label: "T", help: "", rowLabel: "Band", columns: { s: { label: "S", min: 0, max: 9 } }, default: {} };
    expect(isChanged(table, {})).toBe(false);
    expect(isChanged(table, { "3": { s: 2 } })).toBe(true);
  });
});

describe("resetParam", () => {
  it("puts one setting back to its default and leaves the others alone", () => {
    const r = recipe([{ step: "threshold", params: { level: 70, invert: true } }]);
    const out = resetParam(r, 0, "level", reg);
    expect(out.steps[0]!.params).toMatchObject({ level: 50, invert: true });
    expect(r.steps[0]!.params.level).toBe(70);
  });

  it("in one layer's view, removes that layer's own setting so it follows the step again", () => {
    const r = recipe([{ step: "threshold" }, { step: "levels", params: { count: 7 }, layerParams: { ink: { count: 3, smoothing: 2 }, other: { count: 4 } } }]);
    const out = resetParam(r, 1, "count", reg, "ink");
    expect(out.steps[1]!.params.count).toBe(7);
    expect(out.steps[1]!.layerParams).toEqual({ ink: { smoothing: 2 }, other: { count: 4 } });
    expect(resetParam(out, 1, "smoothing", reg, "ink").steps[1]!.layerParams).toEqual({ other: { count: 4 } });
  });
});

describe("resetStep", () => {
  it("puts every setting and layer override back, but keeps the seed, the layer choice and on/off", () => {
    const scatter = defineStep({
      id: "scatter", version: 1, title: "Scatter", summary: "", help: "", input: "layers", output: "layers", cost: "live",
      params: { amount: { type: "number", label: "Amount", help: "", min: 0, max: 10, default: 1 }, seed: seedParam() },
      runLayer: (l) => l,
    });
    const reg2 = new StepRegistry([scatter]);
    const step: RecipeStep = { step: "scatter", version: 1, params: { amount: 8, seed: 4242 }, layers: ["ink"], enabled: false, layerParams: { ink: { amount: 3 } } };
    const r = { ...recipe([]), steps: [step] };
    expect(resetStep(r, 0, reg2).steps[0]).toEqual({ step: "scatter", version: 1, params: { amount: 1, seed: 4242 }, layers: ["ink"], enabled: false });
  });
});
