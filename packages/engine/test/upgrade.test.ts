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
    expect(recipe.schemaVersion).toBe(3);
    expect(recipe.target).toEqual({ kind: "plotter" });
    expect(recipe.layout.marginMm).toBe(15);
    expect(recipe.inks[0]).toEqual({ id: "black", name: "black", color: "#111111", mix: "multiply", widthMm: 0.5 });
    expect(recipe.steps.map((s) => s.step)).toEqual(["threshold", "centerline", "order"]);
    expect(recipe.steps[2]!.params.method).toBe("nearest");
    expect(warnings.filter((w) => /schemaVersion 1 to 2/.test(w.message))).toHaveLength(1);
  });
});

describe("schema v2 → v3: stable step ids", () => {
  const v2 = {
    schemaVersion: 2,
    input: "image",
    paper: { widthMm: 210, heightMm: 148 },
    inks: [{ id: "black", color: "#111111" }],
    steps: [{ step: "tone" }, { step: "levels" }, { step: "bands" }, { step: "fill" }, { step: "fill", enabled: false }, { step: "order" }],
  };
  it("gives every step an id, unique within the recipe, with a warning", () => {
    const { recipe, warnings } = loadRecipe(v2, createRegistry());
    expect(recipe.schemaVersion).toBe(3);
    const ids = recipe.steps.map((s) => s.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(warnings.filter((w) => /schemaVersion 2 to 3/.test(w.message))).toHaveLength(1);
  });
  it("is deterministic: the same recipe gets the same ids", () => {
    const a = loadRecipe(v2, createRegistry()).recipe.steps.map((s) => s.id);
    const b = loadRecipe(structuredClone(v2), createRegistry()).recipe.steps.map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["tone", "levels", "bands", "fill", "fill-2", "order"]);
  });
  it("a v1 recipe goes all the way up and gets ids too", () => {
    const { recipe } = loadRecipe(v1, createRegistry());
    expect(recipe.steps.map((s) => s.id)).toEqual(["threshold", "centerline", "order"]);
  });
});

describe("step ids in a current recipe", () => {
  const base = { schemaVersion: 3, input: "image", paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }] };
  it("keeps the ids it has, through a save and load", () => {
    const { recipe, warnings } = loadRecipe({ ...base, steps: [{ step: "threshold", id: "a" }, { step: "centerline", id: "b" }] }, createRegistry());
    expect(warnings).toEqual([]);
    expect(recipe.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(loadRecipe(JSON.parse(JSON.stringify(recipe)), createRegistry()).recipe.steps.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("fills in missing ids without clashing with the ids that are there", () => {
    const { recipe, warnings } = loadRecipe({ ...base, steps: [{ step: "threshold" }, { step: "centerline", id: "threshold" }] }, createRegistry());
    expect(warnings).toEqual([]);
    expect(recipe.steps.map((s) => s.id)).toEqual(["threshold-2", "threshold"]);
  });
  it("replaces a repeated id, with a warning", () => {
    const { recipe, warnings } = loadRecipe({ ...base, steps: [{ step: "threshold", id: "x" }, { step: "centerline", id: "x" }] }, createRegistry());
    expect(recipe.steps.map((s) => s.id)).toEqual(["x", "centerline"]);
    expect(warnings).toEqual([{ index: 1, message: expect.stringMatching(/id "x" is used twice/) }]);
  });
});
