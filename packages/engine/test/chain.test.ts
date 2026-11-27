import { describe, expect, it } from "vitest";
import { checkChain, insertStep, loadRecipe, moveStep, removeStep, withStepIds } from "../src/index.ts";
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
  it("a layer step may follow a line step that left some layers as they were (one ink each, ADR 0009)", () => {
    const r = loadRecipe(
      { schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps: [{ step: "cmyk" }, { step: "stipple", layers: ["Y"] }, { step: "pixelate", layers: ["M"] }, { step: "centerline" }, { step: "order" }] },
      reg,
    ).recipe;
    expect(checkChain("image", r.steps, reg)).toEqual([]);
  });
  describe("exactly the layers still left (review r1)", () => {
    const steps = (list: Array<string | Record<string, unknown>>) =>
      list.map((s, i) => ({ id: `s${i}`, version: 1, params: {}, enabled: true, ...(typeof s === "string" ? { step: s } : s) }) as never);
    const raw = (list: Array<string | Record<string, unknown>>) => ({ schemaVersion: 4, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps: list.map((s) => (typeof s === "string" ? { step: s } : s)) });
    const refused = (list: Array<string | Record<string, unknown>>, at: number, why: RegExp) => {
      const issues = checkChain("image", steps(list), reg);
      expect(issues[0], JSON.stringify(list)).toMatchObject({ index: at });
      expect(issues[0]!.reason).toMatch(why);
      expect(() => loadRecipe(raw(list), reg)).toThrow();
    };
    it("single ink: the layer names aren't known, so nothing follows the lines", () => {
      refused(["threshold", { step: "centerline", layers: ["threshold"] }, "pixelate", "order"], 2, /Pixelate needs layers, but at that point the chain has lines/);
    });
    it("every ink already lines: nothing is left for a layer step", () => {
      refused(["cmyk", { step: "stipple", layers: ["Y"] }, { step: "centerline", layers: ["C", "M", "K"] }, { step: "pixelate", layers: ["M"] }, "order"], 3, /Pixelate needs layers, but at that point the chain has lines/);
    });
    it("a layer step after the lines must name inks that are still layers", () => {
      refused(["cmyk", { step: "centerline", layers: ["C", "M", "K"] }, { step: "pixelate", layers: ["M"] }, { step: "stipple", layers: ["Y"] }, "order"], 2, /Pixelate needs M as layers, but at that point only Y is still layers; the others are lines/);
    });
    it("a whole-chain layer step after some lines is refused (it would only reach some inks)", () => {
      refused(["cmyk", { step: "stipple", layers: ["Y"] }, "centerline", "order"], 2, /Centerline acts on every ink, but some are already lines at that point. Name the inks that are still layers \(C, M and K\)/);
    });
  });
  it("but not once a line step has turned every layer into lines", () => {
    const steps = ["cmyk", "stipple", "pixelate"].map((step, i) => ({ id: `s${i}`, step, version: 1, params: {}, enabled: true }));
    const issues = checkChain("image", steps, reg);
    expect(issues[0]).toMatchObject({ index: 2 });
    expect(issues[0]!.reason).toMatch(/Pixelate needs layers, but at that point the chain has lines/);
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
  it("adds the step's default inks and points its layers at them", () => {
    const res = insertStep(recipe([]), "cmyk", reg);
    if (!("recipe" in res)) throw new Error(res.reason);
    expect(res.recipe.inks.map((i) => i.id)).toEqual(["k", "cyan", "magenta", "yellow", "black"]);
    expect(res.recipe.layerInks).toEqual({ C: "cyan", M: "magenta", Y: "yellow", K: "black" });
  });
  it("keeps inks and layer assignments the recipe already has", () => {
    const r = { ...recipe([]), layerInks: { K: "k" } };
    r.inks = [...r.inks, { id: "cyan", name: "My cyan", color: "#0af", mix: "multiply", widthMm: 0.5 }];
    const res = insertStep(r, "cmyk", reg);
    if (!("recipe" in res)) throw new Error(res.reason);
    expect(res.recipe.inks.find((i) => i.id === "cyan")!.name).toBe("My cyan");
    expect(res.recipe.inks.filter((i) => i.id === "cyan")).toHaveLength(1);
    expect(res.recipe.layerInks).toEqual({ K: "k", C: "cyan", M: "magenta", Y: "yellow" });
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

describe("stable step ids", () => {
  const stepIds = (r: { steps: Array<{ id: string }> }) => r.steps.map((s) => s.id);
  it("a moved step keeps its id", () => {
    const r = recipe(["tone", "pixelate", "levels", "bands"]);
    const res = moveStep(r, 1, 2, reg);
    if (!("recipe" in res)) throw new Error(res.reason);
    expect(stepIds(res.recipe)).toEqual(["tone", "levels", "pixelate", "bands"]);
  });
  it("an added step gets a new id, unique in the recipe", () => {
    const r = recipe(["tone", "levels", "bands"]);
    const a = insertStep(r, "levels", reg, 1);
    if (!("recipe" in a)) throw new Error(a.reason);
    expect(stepIds(a.recipe)).toEqual(["tone", "levels-2", "levels", "bands"]);
    const b = insertStep(a.recipe, "levels", reg, 1);
    if (!("recipe" in b)) throw new Error(b.reason);
    expect(new Set(stepIds(b.recipe)).size).toBe(5);
  });
  it("removing a step leaves the other ids alone", () => {
    const res = removeStep(recipe(["threshold", "centerline", "order"]), 2, reg);
    expect("recipe" in res && stepIds(res.recipe)).toEqual(["threshold", "centerline"]);
  });
  it("withStepIds fills in missing or repeated ids and keeps the rest", () => {
    const steps = [
      { step: "tone", version: 1, params: {} },
      { step: "fill", version: 1, params: {}, id: "tone" },
      { step: "fill", version: 1, params: {}, id: "tone" },
    ];
    expect(withStepIds(steps).map((s) => s.id)).toEqual(["tone-2", "tone", "fill"]);
  });
});
