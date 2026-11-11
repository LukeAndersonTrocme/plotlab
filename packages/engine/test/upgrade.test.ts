import { describe, expect, it } from "vitest";
import { loadRecipe } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

// Verbatim copy of golden/cases/shapes-centerline.recipe.json as it was at schema v1.
const v1 = {
  schemaVersion: 1,
  input: "image",
  paper: { widthMm: 210, heightMm: 148 },
  pens: [{ id: "black", widthMm: 0.5, color: "#111111" }],
  machine: "generic",
  steps: [
    { step: "threshold", version: 1, params: { mode: "fixed", level: 50 } },
    { step: "centerline", version: 1, params: { minLength: 4, smoothing: 1 } },
    { step: "plot", version: 1, params: { margin: 15, order: "nearest" } },
  ],
};

describe("schema v1 → v2 upgrade", () => {
  it("moves pens to inks, plot margin to layout, plot to order", () => {
    const { recipe, warnings } = loadRecipe(v1, createRegistry());
    expect(recipe.schemaVersion).toBe(2);
    expect(recipe.target).toEqual({ kind: "plotter" });
    expect(recipe.layout.marginMm).toBe(15);
    expect(recipe.inks[0]).toEqual({ id: "black", name: "black", color: "#111111", mix: "multiply", widthMm: 0.5 });
    expect(recipe.steps.map((s) => s.step)).toEqual(["threshold", "centerline", "order"]);
    expect(recipe.steps[2]!.params.method).toBe("nearest");
    expect(warnings.filter((w) => /schemaVersion 1 to 2/.test(w.message))).toHaveLength(1);
  });
});
