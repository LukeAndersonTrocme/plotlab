import { describe, expect, it } from "vitest";
import { lanesOf, loadRecipe, printScreenAngle, PRINT_SCREEN_ANGLES, setLaneParam, splitWith, type Recipe } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
const recipe = (steps: Array<string | Record<string, unknown>>): Recipe =>
  loadRecipe(
    { schemaVersion: 3, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((s) => (typeof s === "string" ? { step: s } : s)) },
    reg,
  ).recipe;
const names = (r: Recipe, idx: number[]) => idx.map((i) => r.steps[i]!.step);

describe("lanesOf: a view of one chain (ADR 0009)", () => {
  it("a recipe without a split is all trunk: no lanes, no stack, linked", () => {
    const r = recipe(["tone", "levels", "bands", "fill", "order"]);
    const v = lanesOf(r, reg);
    expect(v.split).toBeNull();
    expect(names(r, v.trunk)).toEqual(["tone", "levels", "bands", "fill", "order"]);
    expect(v.lanes).toEqual([]);
    expect(v.stack).toEqual([]);
    expect(v.linked).toBe(true);
  });

  it("a linked split: trunk before it, one lane per layer with every following step, then the stack", () => {
    const r = recipe(["reaction", "cmyk", "levels", "bands", "fill", "order"]);
    const v = lanesOf(r, reg);
    expect(names(r, v.trunk)).toEqual(["reaction"]);
    expect(v.split).toBe(1);
    expect(v.layers).toEqual(["C", "M", "Y", "K"]);
    expect(v.lanes.map((l) => l.layer)).toEqual(["C", "M", "Y", "K"]);
    for (const lane of v.lanes) {
      expect(lane.steps.map((s) => s.step)).toEqual(["levels", "bands", "fill"]);
      expect(lane.linked).toBe(true);
      expect(lane.steps.every((s) => s.shared)).toBe(true);
    }
    expect(names(r, v.stack)).toEqual(["order"]);
    expect(v.linked).toBe(true);
    // Lane steps carry the step id, so compare and pins keep referring to steps by id.
    expect(v.lanes[0]!.steps.map((s) => s.id)).toEqual(["levels", "bands", "fill"]);
  });

  it("shows each lane's settings as params merged with that layer's overrides, and reports it unlinked", () => {
    const r = recipe(["cmyk", { step: "levels", params: { count: 4 }, layerParams: { M: { count: 7 } } }, "bands"]);
    const v = lanesOf(r, reg);
    const levels = (layer: string) => v.lanes.find((l) => l.layer === layer)!.steps[0]!;
    expect(levels("C").params.count).toBe(4);
    expect(levels("M").params.count).toBe(7);
    expect(levels("M").shared).toBe(false);
    expect(v.lanes.find((l) => l.layer === "M")!.linked).toBe(false);
    expect(v.lanes.find((l) => l.layer === "C")!.linked).toBe(true);
    expect(v.linked).toBe(false);
  });

  it("a narrowed selector leaves the step out of the other lanes, and the inks aren't linked", () => {
    const r = recipe(["cmyk", { step: "pixelate", layers: ["K"] }, "bands"]);
    const v = lanesOf(r, reg);
    expect(v.lanes.find((l) => l.layer === "K")!.steps.map((s) => s.step)).toEqual(["pixelate", "bands"]);
    expect(v.lanes.find((l) => l.layer === "C")!.steps.map((s) => s.step)).toEqual(["bands"]);
    expect(v.linked).toBe(false);
  });

  it("disabled steps stay in their lane (marked off) and still count for linking; a disabled split is no split", () => {
    const r = recipe(["cmyk", { step: "pixelate", enabled: false, layerParams: { C: { cellMm: 9 } } }, "levels", "bands"]);
    const v = lanesOf(r, reg);
    const c = v.lanes.find((l) => l.layer === "C")!;
    expect(c.steps.map((s) => [s.step, s.enabled])).toEqual([["pixelate", false], ["levels", true], ["bands", true]]);
    expect(c.linked).toBe(false);

    const off = recipe([{ step: "cmyk", enabled: false }, "tone", "levels", "bands"]);
    expect(lanesOf(off, reg).split).toBeNull();
  });

  it("the stack starts at the first step that makes the plot (the merge); a switched-off one doesn't merge", () => {
    const r = recipe(["cmyk", "bands", { step: "order", enabled: false }, "fill", "order"]);
    const v = lanesOf(r, reg);
    expect(v.lanes[0]!.steps.map((s) => s.step)).toEqual(["bands", "order", "fill"]);
    expect(names(r, v.stack)).toEqual(["order"]);
    expect(v.stack).toEqual([4]);
  });
});

describe("setLaneParam: linked edits", () => {
  const r = recipe(["cmyk", "levels", "bands", "fill", "order"]);
  it("a linked edit writes the step's shared params once, whichever lane it's made in", () => {
    for (const lane of [null, "M"]) {
      const res = setLaneParam(r, reg, "fill", "minSpacing", 1.2, lane);
      if ("reason" in res) throw new Error(res.reason);
      const fill = res.recipe.steps.find((s) => s.id === "fill")!;
      expect(fill.params.minSpacing).toBe(1.2);
      expect(fill.layerParams).toBeUndefined();
      // Every lane sees it.
      for (const l of lanesOf(res.recipe, reg).lanes) expect(l.steps.find((s) => s.id === "fill")!.params.minSpacing).toBe(1.2);
      // Nothing else changed.
      expect({ ...res.recipe, steps: res.recipe.steps.filter((s) => s.id !== "fill") }).toEqual({ ...r, steps: r.steps.filter((s) => s.id !== "fill") });
    }
  });
  it("an edit in an independent lane writes that layer's override; a lane that is still linked writes the shared params", () => {
    const ind = recipe(["cmyk", { step: "levels", layerParams: { C: { count: 3 } } }, "bands"]);
    const res = setLaneParam(ind, reg, "levels", "count", 6, "C");
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.steps[1]!.layerParams).toEqual({ C: { count: 6 } });
    expect(res.recipe.steps[1]!.params.count).toBe(ind.steps[1]!.params.count);
    // Lane M has no overrides of its own: it is linked, so the edit is the shared setting.
    const m = setLaneParam(ind, reg, "levels", "smoothing", 2, "M");
    if ("reason" in m) throw new Error(m.reason);
    expect(m.recipe.steps[1]!.params.smoothing).toBe(2);
    expect(m.recipe.steps[1]!.layerParams).toEqual({ C: { count: 3 } });
  });
  it("refuses a step that isn't in that lane: a trunk step, or one narrowed to other inks; and an unknown lane", () => {
    const r2 = recipe(["reaction", "cmyk", { step: "pixelate", layers: ["K"] }, "bands"]);
    expect(setLaneParam(r2, reg, "reaction", "scale", 3, "C")).toEqual({ reason: expect.stringMatching(/isn't in the C lane/) });
    expect(setLaneParam(r2, reg, "pixelate", "cellMm", 3, "C")).toEqual({ reason: expect.stringMatching(/Pixelate isn't in the C lane/) });
    expect("recipe" in setLaneParam(r2, reg, "pixelate", "cellMm", 3, "K")).toBe(true);
    expect(setLaneParam(r2, reg, "bands", "simplify", 1, "Z")).toEqual({ reason: expect.stringMatching(/no Z lane/) });
    // The shared settings (lane null) of a trunk step are fine.
    expect("recipe" in setLaneParam(r2, reg, "reaction", "scale", 3, null)).toBe(true);
  });
  it("refuses unknown steps and settings in plain words", () => {
    expect(setLaneParam(r, reg, "nope", "x", 1, null)).toEqual({ reason: expect.stringMatching(/no step/i) });
    expect(setLaneParam(r, reg, "fill", "nope", 1, null)).toEqual({ reason: expect.stringMatching(/Fill has no setting "nope"/) });
  });
});

describe("splitWith: splitting from the photo", () => {
  it("takes the place of the step that made the layers; the following layer steps act on all four inks, linked", () => {
    const r = recipe(["tone", { step: "levels", params: { count: 5 }, layers: ["tone"], layerParams: { tone: { smoothing: 2 } } }, "bands", "fill", "order"]);
    const res = splitWith(r, "cmyk", reg);
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.steps.map((s) => s.step)).toEqual(["cmyk", "levels", "bands", "fill", "order"]);
    expect(res.index).toBe(0);
    expect(res.replaced).toBe("Ink density");
    const levels = res.recipe.steps[1]!;
    expect(levels.layers).toBeUndefined();
    expect(levels.layerParams).toBeUndefined();
    // The old single layer's overrides become the shared settings (what you saw stays).
    expect(levels.params).toMatchObject({ count: 5, smoothing: 2 });
    // Ids of the steps that stay are kept (pins and compare refer to them).
    expect(res.recipe.steps.slice(1).map((s) => s.id)).toEqual(r.steps.slice(1).map((s) => s.id));
    const v = lanesOf(res.recipe, reg);
    expect(v.lanes).toHaveLength(4);
    expect(v.linked).toBe(true);
    expect(names(res.recipe, v.stack)).toEqual(["order"]);
    expect(res.recipe.layerInks).toEqual({ C: "cyan", M: "magenta", Y: "yellow", K: "black" });
    expect(res.recipe.screenAngles).toBe(true);
  });
  it("keeps image steps before it in the trunk, and only fits where the chain still has the picture", () => {
    const r = recipe(["reaction", "threshold", "centerline", "order"]);
    expect("reason" in splitWith(r, "cmyk", reg, 0)).toBe(true);
    const res = splitWith(r, "cmyk", reg, 1);
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.steps.map((s) => s.step)).toEqual(["reaction", "cmyk", "centerline", "order"]);
    expect(lanesOf(res.recipe, reg).trunk).toEqual([0]);
  });
  it("on an empty recipe it just adds the split", () => {
    const res = splitWith(recipe([]), "cmyk", reg);
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.steps.map((s) => s.step)).toEqual(["cmyk"]);
    expect(res.replaced).toBeNull();
    expect(lanesOf(res.recipe, reg).lanes).toHaveLength(4);
  });
  it("refuses a second split, and steps that don't split", () => {
    const split = recipe(["cmyk", "bands"]);
    expect(splitWith(split, "cmyk", reg)).toEqual({ reason: expect.stringMatching(/already split/) });
    expect(splitWith(recipe(["tone"]), "tone", reg)).toEqual({ reason: expect.stringMatching(/doesn't split/) });
  });
  it("refuses a second Separate CMYK when one is there but switched off, and says to switch it back on", () => {
    const off = recipe([{ step: "cmyk", enabled: false }, "tone", "levels", "bands"]);
    for (const gap of [undefined, 0, 1]) expect(splitWith(off, "cmyk", reg, gap)).toEqual({ reason: expect.stringMatching(/Separate CMYK is already in the recipe, switched off\. Switch it back on/) });
  });
});

describe("print screen angles", () => {
  it("are C 15°, M 75°, Y 0°, K 45°", () => {
    expect(PRINT_SCREEN_ANGLES).toEqual({ C: 15, M: 75, Y: 0, K: 45 });
    expect(["C", "M", "Y", "K"].map((id, i) => printScreenAngle(id, i))).toEqual([15, 75, 0, 45]);
    expect(printScreenAngle("K", 0)).toBe(45);
  });
  it("other layers get the classic angle for their position", () => {
    expect(printScreenAngle("tone", 0)).toBe(15);
    expect(printScreenAngle("x", 5)).toBe(82.5);
  });
});
