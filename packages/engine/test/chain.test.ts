import { describe, expect, it } from "vitest";
import { checkChain, insertStep, loadRecipe, moveStep, removeStep } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
const recipe = (steps: string[]) =>
  loadRecipe({ schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((step) => ({ step })) }, reg).recipe;
const ids = (r: { steps: Array<{ step: string }> }) => r.steps.map((s) => s.step);

describe("checkChain", () => {
  it("finds the first step that gets the wrong kind of data", () => {
    const issues = checkChain("image", recipe(["threshold", "centerline"]).steps.reverse(), reg);
    expect(issues[0]).toMatchObject({ index: 0 });
    expect(issues[0]!.reason).toMatch(/Centerline needs layers, but at that point the chain has an image/);
    expect(issues[0]!.reason).toMatch(/like Threshold/);
  });
  it("skips disabled steps", () => {
    const steps = recipe(["threshold", "centerline", "order"]).steps;
    steps[1]!.enabled = false;
    expect(checkChain("image", steps, reg)[0]!.reason).toMatch(/Stroke order needs lines/);
  });
});

describe("moveStep", () => {
  const r = recipe(["threshold", "centerline", "order"]);
  it("refuses an invalid move with a reason and leaves the recipe alone", () => {
    const res = moveStep(r, 1, 0, reg);
    expect("reason" in res && res.reason).toMatch(/Centerline needs layers, but .* has an image/);
    expect(ids(r)).toEqual(["threshold", "centerline", "order"]);
  });
  it("allows a valid move (here: a no-op round trip)", () => {
    const res = moveStep(r, 1, 1, reg);
    expect("recipe" in res && ids(res.recipe)).toEqual(["threshold", "centerline", "order"]);
  });
});

describe("insertStep", () => {
  it("puts a step at the first place it fits, with default params", () => {
    const res = insertStep(recipe(["threshold", "centerline"]), "order", reg);
    expect("recipe" in res && res.index).toBe(2);
    expect("recipe" in res && res.recipe.steps[2]!.params.method).toBe("nearest");
  });
  it("explains when there is nowhere it fits", () => {
    const res = insertStep(recipe([]), "centerline", reg);
    expect("reason" in res && res.reason).toMatch(/Centerline needs layers/);
  });
});

describe("removeStep", () => {
  it("refuses to remove a step others depend on, naming who breaks", () => {
    const res = removeStep(recipe(["threshold", "centerline", "order"]), 0, reg);
    expect("reason" in res && res.reason).toMatch(/Centerline/);
  });
  it("removes a step at the end", () => {
    const res = removeStep(recipe(["threshold", "centerline", "order"]), 2, reg);
    expect("recipe" in res && ids(res.recipe)).toEqual(["threshold", "centerline"]);
  });
});
