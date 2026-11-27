import { describe, expect, it } from "vitest";
import { addInLane, checkChain, insertStep, moveStep, removeStep, resetLaneStep, Pipeline, type RawImage, laneIssues, lanesOf, linkLanes, linkLoss, loadRecipe, moveInLane, removeFromLane, setLaneParam, unlinkLanes, type Recipe } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
const recipe = (steps: Array<string | Record<string, unknown>>): Recipe =>
  loadRecipe(
    { schemaVersion: 4, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((s) => (typeof s === "string" ? { step: s } : s)) },
    reg,
  ).recipe;
const ok = <T extends object>(res: T | { reason: string }): T => {
  if ("reason" in res) throw new Error(`refused: ${res.reason}`);
  return res;
};
/** What a lane shows: its steps, by step name. */
const lane = (r: Recipe, layer: string) => lanesOf(r, reg).lanes.find((l) => l.layer === layer)!;
const laneSteps = (r: Recipe, layer: string) => lane(r, layer).steps.map((s) => s.step);
const shows = (r: Recipe) => Object.fromEntries(lanesOf(r, reg).lanes.map((l) => [l.layer, l.steps.map((s) => [s.step, s.params])]));
/** Still a valid chain, and every lane makes sense on its own (and loads back the same). */
const sound = (r: Recipe) => {
  expect(checkChain(r.input, r.steps, reg)).toEqual([]);
  expect(laneIssues(r, reg)).toEqual([]);
  expect(loadRecipe(JSON.parse(JSON.stringify(r)), reg).recipe).toEqual(r);
};

const linked = () => recipe(["cmyk", "centerline", "order"]);

describe("unlink: every lane shows exactly what it showed before", () => {
  it("copies the shared settings into each ink's own settings", () => {
    const r = recipe(["cmyk", { step: "levels", params: { count: 4 } }, "bands", { step: "fill", params: { angle: 20 } }, "order"]);
    const before = shows(r);
    const u = ok(unlinkLanes(r, reg)).recipe;
    expect(shows(u)).toEqual(before);
    const v = lanesOf(u, reg);
    expect(v.linked).toBe(false);
    expect(v.lanes.every((l) => !l.linked && l.steps.every((s) => !s.shared))).toBe(true);
    expect(u.steps[1]!.layerParams!.M).toEqual(u.steps[1]!.params);
    sound(u);
  });
  it("refuses when the picture isn't split, or the inks are already independent", () => {
    expect(unlinkLanes(recipe(["threshold", "centerline", "order"]), reg)).toEqual({ reason: expect.stringMatching(/isn't split/) });
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    expect(unlinkLanes(u, reg)).toEqual({ reason: expect.stringMatching(/already independent/) });
  });
  it("then a setting changed in one lane changes only that ink", () => {
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    const e = ok(setLaneParam(u, reg, "centerline", "minLength", 3, "M")).recipe;
    expect(lane(e, "M").steps[0]!.params.minLength).toBe(3);
    for (const x of ["C", "Y", "K"]) expect(lane(e, x).steps[0]!.params).toEqual(lane(u, x).steps[0]!.params);
  });
});

describe("addInLane: + in lane X adds a step for that ink only", () => {
  it("inserts the step with layers: [X], and only lane X shows it", () => {
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    const res = ok(addInLane(u, reg, "M", "pixelate", 0));
    expect(res.recipe.steps[res.index]).toMatchObject({ step: "pixelate", layers: ["M"] });
    expect(laneSteps(res.recipe, "M")).toEqual(["pixelate", "centerline"]);
    for (const x of ["C", "Y", "K"]) expect(laneSteps(res.recipe, x)).toEqual(["centerline"]);
    sound(res.recipe);
  });
  it("refuses a step that would come after the ink is already lines, saying what to do", () => {
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    const res = addInLane(u, reg, "Y", "stipple", 1);
    expect(res).toEqual({ reason: expect.stringMatching(/Stipple needs Y as layers.*already lines.*Centerline/) });
  });
  it("refuses a step that doesn't work on one ink, an unknown lane and a gap that isn't there", () => {
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    expect(addInLane(u, reg, "M", "order", 1)).toEqual({ reason: expect.stringMatching(/Stroke order works on every ink at once/) });
    expect(addInLane(u, reg, "Z", "pixelate", 0)).toEqual({ reason: expect.stringMatching(/no Z lane/) });
    expect(addInLane(u, reg, "M", "pixelate", 5)).toEqual({ reason: expect.stringMatching(/no place 6 in the M lane/) });
  });
});

describe("removeFromLane: narrows the selector, or removes the step", () => {
  it("takes the step out of lane X only, and drops X's own settings", () => {
    const u = ok(unlinkLanes(linked(), reg)).recipe;
    const r = ok(removeFromLane(u, reg, "centerline", "Y")).recipe;
    expect(r.steps.find((s) => s.id === "centerline")).toMatchObject({ layers: ["C", "M", "K"] });
    expect(r.steps.find((s) => s.id === "centerline")!.layerParams!.Y).toBeUndefined();
    expect(laneSteps(r, "Y")).toEqual([]);
    for (const x of ["C", "M", "K"]) expect(laneSteps(r, x)).toEqual(["centerline"]);
    sound(r);
  });
  it("removes the step when X was its only ink", () => {
    const u = ok(addInLane(ok(unlinkLanes(linked(), reg)).recipe, reg, "M", "pixelate", 0)).recipe;
    const r = ok(removeFromLane(u, reg, "pixelate", "M"));
    expect(r.recipe.steps.map((s) => s.step)).toEqual(["cmyk", "centerline", "order"]);
  });
  it("refuses a step that isn't in that lane", () => {
    const u = ok(addInLane(ok(unlinkLanes(linked(), reg)).recipe, reg, "M", "pixelate", 0)).recipe;
    expect(removeFromLane(u, reg, "pixelate", "C")).toEqual({ reason: expect.stringMatching(/Pixelate isn't in the C lane/) });
    expect(removeFromLane(u, reg, "cmyk", "C")).toEqual({ reason: expect.stringMatching(/isn't in the C lane/) });
  });
});

describe("pixelated magenta, stippled yellow", () => {
  it("is built from lane edits: Pixelate in M, Centerline out of Y, Stipple in Y", () => {
    let r = ok(unlinkLanes(linked(), reg)).recipe;
    r = ok(addInLane(r, reg, "M", "pixelate", 0)).recipe;
    r = ok(removeFromLane(r, reg, "centerline", "Y")).recipe;
    r = ok(addInLane(r, reg, "Y", "stipple", 0)).recipe;
    expect(laneSteps(r, "M")).toEqual(["pixelate", "centerline"]);
    expect(laneSteps(r, "Y")).toEqual(["stipple"]);
    expect(laneSteps(r, "C")).toEqual(["centerline"]);
    expect(laneSteps(r, "K")).toEqual(["centerline"]);
    sound(r);
    // A new line step goes as late as it fits, so the other inks' lines don't wait for it.
    expect(r.steps.map((s) => s.step)).toEqual(["cmyk", "pixelate", "centerline", "stipple", "order"]);
  });
  it("and plots: magenta's lines come from the pixelated layer, yellow's are dots", async () => {
    let r = ok(unlinkLanes(linked(), reg)).recipe;
    r = ok(addInLane(r, reg, "M", "pixelate", 0)).recipe;
    r = ok(removeFromLane(r, reg, "centerline", "Y")).recipe;
    r = ok(addInLane(r, reg, "Y", "stipple", 0)).recipe;
    const W = 40;
    const data = new Float32Array(W * W * 3).map((_, i) => ((i % 3) + ((i / 3) % W) / W) / 3);
    const img: RawImage = { width: W, height: W, channels: 3, data };
    const { plot } = await new Pipeline(reg).run(img, { ...r, workingMmPerPx: 2.5 });
    for (const id of ["M", "Y"]) expect(plot?.layers.find((l) => l.id === id)?.paths.length, `${id} has lines`).toBeGreaterThan(0);
    // Stipple dots are tiny strokes; Centerline's are longer.
    const y = plot!.layers.find((l) => l.id === "Y")!;
    expect(y.paths.every((p) => p.length <= 16)).toBe(true);
    expect(plot!.rasterLayers?.layers ?? []).toEqual([]);
  });
});

describe("moveInLane: keeps every lane's order valid", () => {
  const twoSteps = () => {
    let r = ok(unlinkLanes(recipe(["cmyk", "levels", "bands", "order"]), reg)).recipe;
    r = ok(addInLane(r, reg, "M", "pixelate", 0)).recipe;
    return r;
  };
  it("moves a step later in its lane; the other lanes keep their order", () => {
    const r = ok(moveInLane(twoSteps(), reg, "pixelate", "M", 1)).recipe;
    expect(laneSteps(r, "M")).toEqual(["levels", "pixelate", "bands"]);
    expect(laneSteps(r, "C")).toEqual(["levels", "bands"]);
    sound(r);
  });
  it("refuses a move that would put a layer step after the ink's lines", () => {
    const res = moveInLane(twoSteps(), reg, "pixelate", "M", 2);
    expect(res).toEqual({ reason: expect.stringMatching(/Pixelate can't go there in the M lane/) });
  });
  it("moving to where it is changes nothing", () => {
    const r = twoSteps();
    expect(ok(moveInLane(r, reg, "pixelate", "M", 0)).recipe).toBe(r);
  });
});

describe("link: collapses every lane onto one (lossy)", () => {
  const mixed = () => {
    let r = ok(unlinkLanes(linked(), reg)).recipe;
    r = ok(addInLane(r, reg, "M", "pixelate", 0)).recipe;
    r = ok(setLaneParam(r, reg, "centerline", "minLength", 3, "C")).recipe;
    return r;
  };
  it("every lane then shows what the chosen lane showed, linked", () => {
    const r = mixed();
    const m = lane(r, "M").steps.map((s) => [s.step, s.params]);
    const l = ok(linkLanes(r, reg, "M")).recipe;
    const v = lanesOf(l, reg);
    expect(v.linked).toBe(true);
    for (const x of v.lanes) expect(x.steps.map((s) => [s.step, s.params])).toEqual(m);
    expect(l.steps.every((s) => s.layers === undefined && s.layerParams === undefined)).toBe(true);
    sound(l);
  });
  it("drops the steps the chosen lane doesn't have", () => {
    const l = ok(linkLanes(mixed(), reg, "C")).recipe;
    expect(l.steps.map((s) => s.step)).toEqual(["cmyk", "centerline", "order"]);
    expect(l.steps[1]!.params.minLength).toBe(3);
  });
  it("says what will be lost: the lanes that differ from the chosen one", () => {
    expect(linkLoss(mixed(), reg, "C")).toEqual(["Magenta: Pixelate → Centerline", "Yellow: Centerline (its own settings)", "Black: Centerline (its own settings)"]);
    expect(linkLoss(ok(unlinkLanes(linked(), reg)).recipe, reg, "C")).toEqual([]);
  });
  it("refuses when already linked or the lane isn't there", () => {
    expect(linkLanes(linked(), reg, "C")).toEqual({ reason: expect.stringMatching(/already linked/) });
    expect(linkLanes(mixed(), reg, "Z")).toEqual({ reason: expect.stringMatching(/no Z lane/) });
  });
});

describe("laneIssues: each lane on its own", () => {
  it("finds a lines step (Fill) in a lane whose ink isn't lines yet", () => {
    const r = recipe(["cmyk", "levels", { step: "bands", layers: ["C", "M", "K"] }, "fill", "order"]);
    expect(laneIssues(r, reg)).toEqual([{ layer: "Y", index: 3, reason: expect.stringMatching(/Fill works on Y's lines, but in the Y lane it isn't lines yet/) }]);
  });
  it("so taking the line step out of a lane asks for Fill to go first", () => {
    const u = ok(unlinkLanes(recipe(["cmyk", "levels", "bands", "fill", "order"]), reg)).recipe;
    expect(removeFromLane(u, reg, "bands", "Y")).toEqual({ reason: expect.stringMatching(/Taking Bands out of the Y lane would break it: Fill works on Y's lines/) });
    const r = ok(removeFromLane(ok(removeFromLane(u, reg, "fill", "Y")).recipe, reg, "bands", "Y")).recipe;
    expect(laneSteps(r, "Y")).toEqual(["levels"]);
  });
  it("finds a layer step that comes after that ink became lines", () => {
    // checkChain refuses this chain too (a whole-chain step after some lines); laneIssues names the ink.
    const base = recipe(["cmyk", { step: "stipple", layers: ["Y"] }, { step: "centerline", layers: ["C", "M", "K"] }, "order"]);
    const r = { ...base, steps: base.steps.map((s) => (s.step === "centerline" ? { ...s, layers: undefined } : s)) };
    expect(laneIssues(r, reg)).toEqual([{ layer: "Y", index: 2, reason: expect.stringMatching(/Centerline needs Y as layers.*already lines.*Stipple/) }]);
  });
});

describe("whole-chain edits keep every lane working (review r1)", () => {
  // Pixelated magenta, stippled yellow, then a Fill for the lines.
  const built = () => recipe(["cmyk", { step: "pixelate", layers: ["M"] }, { step: "centerline", layers: ["C", "M", "K"] }, { step: "stipple", layers: ["Y"] }, "fill", "order"]);
  const at = (r: Recipe, step: string) => r.steps.findIndex((s) => s.step === step);
  it("the sidebar's ↓ on Pixelate can't take it past magenta's line step", () => {
    const r = built();
    expect(moveStep(r, at(r, "pixelate"), at(r, "pixelate") + 1, reg)).toEqual({ reason: expect.stringMatching(/Pixelate needs M as layers, but at that point only Y is still layers/) });
  });
  it("moving Fill before yellow's line step would leave Fill doing nothing for yellow", () => {
    const r = built();
    expect(moveStep(r, at(r, "fill"), at(r, "stipple"), reg)).toEqual({ reason: expect.stringMatching(/Fill works on Y's lines, but in the Y lane it isn't lines yet/) });
  });
  it("removing a line step that a lane's Fill needs says so", () => {
    const r = built();
    expect(removeStep(r, at(r, "centerline"), reg)).toEqual({ reason: expect.stringMatching(/Fill works on C's lines/) });
  });
  it("adding a whole-chain Fill where some inks aren't lines yet is refused", () => {
    const r = built();
    expect(insertStep(r, "fill", reg, at(r, "stipple"))).toEqual({ reason: expect.stringMatching(/Fill works on Y's lines/) });
  });
  it("an issue the recipe already had doesn't block other edits", () => {
    // Fill for every ink, but Y is never lines: loads as before (the old chain rules).
    const r = recipe(["cmyk", "levels", { step: "bands", layers: ["C", "M", "K"] }, "fill", "order"]);
    expect(laneIssues(r, reg)).toHaveLength(1);
    expect("recipe" in moveStep(r, 1, 1, reg)).toBe(true);
    expect("recipe" in insertStep(r, "pixelate", reg, 1)).toBe(true);
  });
});

describe("resetLaneStep: Defaults for this step, from a lane (review r1)", () => {
  it("puts only that ink's settings back to the defaults; the other inks keep theirs", () => {
    let r = recipe(["cmyk", { step: "centerline", params: { minLength: 2 } }, "order"]);
    r = ok(unlinkLanes(r, reg)).recipe;
    r = ok(setLaneParam(r, reg, "centerline", "minLength", 3, "M")).recipe;
    const d = ok(resetLaneStep(r, reg, "centerline", "M")).recipe;
    const defaults = recipe(["cmyk", "centerline"]).steps[1]!.params;
    expect(lane(d, "M").steps[0]!.params).toEqual(defaults);
    for (const x of ["C", "Y", "K"]) expect(lane(d, x).steps[0]!.params.minLength).toBe(2);
    expect(lanesOf(d, reg).linked).toBe(false);
  });
  it("refuses a step that isn't in that lane", () => {
    const r = ok(unlinkLanes(linked(), reg)).recipe;
    expect(resetLaneStep(r, reg, "order", "M")).toEqual({ reason: expect.stringMatching(/isn't in the M lane/) });
  });
});
