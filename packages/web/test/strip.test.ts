import { describe, expect, it } from "vitest";
import { loadRecipe, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { removeCheck, shownAt, stripBoxes, stripLanes, thumbRenderSide, toggleBypass } from "../src/strip.ts";

const reg = createRegistry();
const recipe = (steps: Array<string | { step: string; enabled?: boolean }>): Recipe =>
  loadRecipe(
    { schemaVersion: 3, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((s) => (typeof s === "string" ? { step: s } : s)) },
    reg,
  ).recipe;
const ran = (...indices: number[]) => ({ steps: indices.map((index) => ({ index })), stale: [] as number[] });

describe("strip boxes", () => {
  const r = recipe(["tone", "levels", "bands", "fill", "order"]);

  it("one box for the source, then one per step, keyed by step id", () => {
    const boxes = stripBoxes(r, reg, ran(0, 1, 2, 3, 4));
    expect(boxes.map((b) => b.key)).toEqual(["source", "tone", "levels", "bands", "fill", "order"]);
    expect(boxes.map((b) => b.index)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(boxes[0]).toMatchObject({ title: "Source", input: "image", output: "image", bypass: null });
    expect(boxes[1]).toMatchObject({ title: "Ink density", input: "image", output: "layers", status: "ran" });
  });

  it("every box has an icon", () => {
    for (const b of stripBoxes(r, reg, ran())) expect(b.icon).not.toBe("");
  });

  it("steps that keep their stage can be switched off; the others say why not", () => {
    const boxes = stripBoxes(r, reg, ran(0, 1, 2, 3, 4));
    const levels = boxes.find((b) => b.key === "levels")!;
    expect(levels.bypass).toEqual({ ok: true });
    const tone = boxes.find((b) => b.key === "tone")!;
    expect(tone.bypass).toEqual({ ok: false, reason: expect.stringMatching(/switch off Ink density here: it turns an image into layers/) });
    expect(boxes.find((b) => b.key === "order")!.bypass).toMatchObject({ ok: false, reason: expect.stringMatching(/lines into a plot/) });
  });

  it("a switched-off step is marked off", () => {
    const boxes = stripBoxes(recipe(["tone", { step: "levels", enabled: false }, "bands"]), reg, ran(0, 2));
    expect(boxes.map((b) => b.status)).toEqual(["ran", "ran", "off", "ran"]);
  });

  it("an on-demand step that hasn't run, and what follows it, wait (they show traced order)", () => {
    const boxes = stripBoxes(recipe(["threshold", "centerline", "order"]), reg, { steps: [{ index: 0 }, { index: 1 }], stale: [2] });
    expect(boxes.map((b) => b.status)).toEqual(["ran", "ran", "ran", "waiting"]);
  });

  it("steps not reached (an error earlier) are not shown as up to date", () => {
    const boxes = stripBoxes(recipe(["threshold", "centerline", "order"]), reg, ran(0));
    expect(boxes.map((b) => b.status)).toEqual(["ran", "ran", "none", "none"]);
  });
});

describe("toggleBypass", () => {
  it("switches a same-stage step off and on again", () => {
    const r = recipe(["tone", "levels", "bands"]);
    const off = toggleBypass(r, 1, reg);
    if (!("recipe" in off)) throw new Error(off.reason);
    expect(off.recipe.steps[1]!.enabled).toBe(false);
    const on = toggleBypass(off.recipe, 1, reg);
    if (!("recipe" in on)) throw new Error(on.reason);
    expect(on.recipe.steps[1]!.enabled).toBe(true);
    expect(on.recipe.steps[1]!.id).toBe("levels");
  });

  it("refuses a step that changes stage, with the reason, and leaves the recipe alone", () => {
    const r = recipe(["tone", "levels", "bands"]);
    const res = toggleBypass(r, 0, reg);
    expect("reason" in res && res.reason).toMatch(/Can't switch off Ink density/);
    expect(r.steps[0]!.enabled).toBe(true);
  });

  it("turning a step on where it doesn't fit says why", () => {
    // Pixelate works on layers; switched off at the start of an image chain, it can't go on.
    const r = recipe([{ step: "pixelate", enabled: false }, "tone"]);
    const res = toggleBypass(r, 0, reg);
    expect("reason" in res && res.reason).toMatch(/Turning on Pixelate would break the chain/);
  });
});

describe("switching a stage-changing step back on", () => {
  // The strip's bypass and the sidebar's Switch on both use this, so they agree.
  const r = recipe(["tone", "bands", "fill", { step: "order", enabled: false }]);

  it("a stage-changing step that is off (say, in a loaded recipe) can go back on where it fits", () => {
    expect(stripBoxes(r, reg, ran()).find((b) => b.key === "order")!.bypass).toEqual({ ok: true });
    const on = toggleBypass(r, 3, reg);
    if (!("recipe" in on)) throw new Error(on.reason);
    expect(on.recipe.steps[3]!.enabled).toBe(true);
    // ...and then, being on, it can't be switched off again.
    expect(toggleBypass(on.recipe, 3, reg)).toEqual({ reason: expect.stringMatching(/Can't switch off Stroke order/) });
  });
});

describe("removeCheck: whether Remove works on a step", () => {
  it("a step whose removal keeps the chain working can be removed", () => {
    const r = recipe(["tone", "levels", "bands", "fill", "order"]);
    expect(removeCheck(r, 1, reg)).toEqual({ ok: true });
    expect(removeCheck(r, 4, reg)).toEqual({ ok: true });
  });

  it("removing a step the next one needs says why", () => {
    const r = recipe(["tone", "levels", "bands", "fill", "order"]);
    expect(removeCheck(r, 0, reg)).toEqual({ ok: false, reason: expect.stringMatching(/^Removing Ink density would break the chain: /) });
  });
});

describe("shownAt: which output a box shows", () => {
  it("its own when it ran, else what passes through (the last step before it that ran), else the source", () => {
    expect(shownAt(2, [0, 1, 2])).toBe(2);
    expect(shownAt(2, [0, 3])).toBe(0);
    expect(shownAt(0, [1, 2])).toBe(-1);
    expect(shownAt(-1, [0])).toBe(-1);
  });
});

describe("thumbRenderSide", () => {
  it("covers the box at the screen's pixel density, in a few sizes so renders can be reused", () => {
    expect(thumbRenderSide(96, 1)).toBe(96);
    expect(thumbRenderSide(96, 2)).toBe(192);
    expect(thumbRenderSide(100, 1)).toBe(128);
    expect(thumbRenderSide(20, 1)).toBe(64);
    expect(thumbRenderSide(200, 3)).toBe(400);
  });
});

describe("strip lanes: CMYK as one row of 2×2 thumbnails, then a Stack box", () => {
  it("a chain without a split has no lane row and no Stack box", () => {
    const r = recipe(["tone", "levels", "bands", "fill", "order"]);
    expect(stripBoxes(r, reg, ran()).map((b) => b.lane)).toEqual([null, null, null, null, null, null]);
    expect(stripLanes(r, reg)).toBeNull();
  });
  it("a split chain: the trunk, then the split and the steps in the lanes as 2×2 boxes, then the Stack box before the stack steps", () => {
    const r = recipe(["reaction", "cmyk", "levels", "bands", "fill", "order"]);
    expect(stripBoxes(r, reg, ran()).map((b) => b.lane)).toEqual([null, null, "split", "lane", "lane", "lane", null]);
    expect(stripLanes(r, reg)).toEqual({ layers: ["C", "M", "Y", "K"], names: ["Cyan", "Magenta", "Yellow", "Black"], linked: true, stackAfter: 4, screenAngles: false });
  });
  it("the Stack box follows the split itself when no step comes after it", () => {
    expect(stripLanes(recipe(["cmyk"]), reg)?.stackAfter).toBe(0);
  });
});
