import { describe, expect, it } from "vitest";
import { addBox, applyBox, applyLens, bandView, boxRect, DEFAULT_BOX, fitLens, MAX_BOXES, MAX_LENS, MIN_BOX, MIN_LENS, moveBox, moveLens, removeBox, resizeBox, resizeLens, setBoxStep, setInLens, setUnder, shiftAdd, shiftRefusal, shownBands } from "../src/compare.ts";
import { applySplits, bandInUse, stripView, nextBand, addBand, compareTargets, dragSplit, everyStep, evenSplits, makeCompare, MAX_STRIPS, MIN_GAP, pruneCompare, readCompare, removeBand, setBand, setLayout, thisVsBefore, type Compare } from "../src/compare.ts";

/** Only the step ids (and whether a step is on) matter to the comparison. */
const chain = (...ids: string[]) => ({ steps: ids.map((id) => ({ id, enabled: !id.endsWith("-off") })) });
const r = chain("tone", "threshold", "centerline", "order");

describe("compare: a new comparison", () => {
  it("strips start evenly spaced, side by side, with a default lens and no boxes", () => {
    const c = makeCompare(["source", "tone", "order"]);
    expect(c.layout).toBe("cols");
    expect(c.bands).toEqual(["source", "tone", "order"]);
    expect(c.splits.map((s) => +s.toFixed(4))).toEqual([0.3333, 0.6667]);
    expect(c.lens).toEqual({ x: 0.5, y: 0.42, r: 0.18 });
    expect(c.boxes).toEqual([]);
    expect(evenSplits(1)).toEqual([]);
    expect(evenSplits(2)).toEqual([0.5]);
  });

  it("“This step vs the one before”: the step before the selected one, then the selected one", () => {
    expect(thisVsBefore(r, 2).bands).toEqual(["threshold", "centerline"]);
  });

  it("“This step vs the one before” on the first step compares it with the source", () => {
    expect(thisVsBefore(r, 0).bands).toEqual(["source", "tone"]);
  });

  it("“This step vs the one before” with no step selected: the source against the last step", () => {
    expect(thisVsBefore(r, -1).bands).toEqual(["source", "order"]);
    expect(thisVsBefore(chain(), -1).bands).toEqual(["source"]);
  });

  it("“Every step”: the source, then every step that is on", () => {
    expect(everyStep(chain("tone", "dither-off", "fill")).bands).toEqual(["source", "tone", "fill"]);
  });

  it("“Every step” keeps to six strips: the source and the last five steps", () => {
    const long = chain("a", "b", "c", "d", "e", "f", "g");
    expect(everyStep(long).bands).toEqual(["source", "c", "d", "e", "f", "g"]);
    expect(everyStep(long).bands).toHaveLength(MAX_STRIPS);
  });

  it("a shortcut keeps the layout you were using", () => {
    expect(thisVsBefore(r, 1, "rows").layout).toBe("rows");
    expect(everyStep(r, "rows").layout).toBe("rows");
  });
});

describe("compare: adding and removing strips", () => {
  it("adds a strip at the end and spaces the strips evenly again", () => {
    const c = addBand(makeCompare(["source", "tone"]), "order");
    expect(c.bands).toEqual(["source", "tone", "order"]);
    expect(c.splits).toEqual(evenSplits(3));
  });

  it("+ Strip offers the step after the last strip's step (the first step after the source; the last step stays the last)", () => {
    expect(nextBand(makeCompare(["source", "tone"]), r)).toBe("threshold");
    expect(nextBand(makeCompare(["tone", "source"]), r)).toBe("tone");
    expect(nextBand(makeCompare(["source", "order"]), r)).toBe("order");
    expect(nextBand(makeCompare(["source"]), chain())).toBe("source");
  });

  it("six strips is the most: a seventh changes nothing", () => {
    const six = makeCompare(["source", "a", "b", "c", "d", "e"]);
    expect(addBand(six, "f")).toBe(six);
  });

  it("removing a strip gives its room to the strip beside it; the other dividers stay where you put them", () => {
    let c = makeCompare(["source", "tone", "threshold", "order"]);
    c = dragSplit(c, 0, 0.1);
    const removed = removeBand(c, 2);
    expect(removed.bands).toEqual(["source", "tone", "order"]);
    expect(removed.splits).toEqual([0.1, 0.75]);
    expect(removeBand(c, 0).splits).toEqual([0.5, 0.75]);
  });

  it("the last strip can't be removed", () => {
    const one = makeCompare(["tone"]);
    expect(removeBand(one, 0)).toBe(one);
  });

  it("a strip's chip picks another step for it", () => {
    const c = makeCompare(["source", "tone"]);
    expect(setBand(c, 1, "order").bands).toEqual(["source", "order"]);
    expect(setBand(c, 1, "tone")).toBe(c);
    expect(setBand(c, 5, "order")).toBe(c);
  });

  it("a chip can't pick a step that another strip already shows (the same rule as shift-click)", () => {
    const c = makeCompare(["source", "tone", "order"]);
    expect(setBand(c, 1, "source")).toBe(c);
    expect(setBand(c, 1, "order")).toBe(c);
    expect(bandInUse(c, 1, "source")).toBe(true);
    expect(bandInUse(c, 1, "tone")).toBe(false); // its own step stays pickable
    expect(bandInUse(c, 1, "threshold")).toBe(false);
  });

  it("switching between side by side and top to bottom keeps the strips and dividers", () => {
    const c = dragSplit(makeCompare(["source", "tone"]), 0, 0.3);
    const rows = setLayout(c, "rows");
    expect(rows.layout).toBe("rows");
    expect(rows.bands).toEqual(c.bands);
    expect(rows.splits).toEqual([0.3]);
    expect(setLayout(rows, "rows")).toBe(rows);
  });
});

describe("compare: dragging a divider", () => {
  it("moves the divider", () => {
    expect(dragSplit(makeCompare(["source", "tone"]), 0, 0.3).splits).toEqual([0.3]);
  });

  it("can't cross the divider next to it: it stops a minimum gap short", () => {
    const c = makeCompare(["source", "tone", "threshold"]); // dividers at 1/3, 2/3
    expect(dragSplit(c, 0, 0.9).splits[0]).toBeCloseTo(2 / 3 - MIN_GAP);
    expect(dragSplit(c, 1, 0.1).splits[1]).toBeCloseTo(1 / 3 + MIN_GAP);
  });

  it("can't leave the paper: the first and last strips keep a minimum width", () => {
    const c = makeCompare(["source", "tone"]);
    expect(dragSplit(c, 0, -2).splits).toEqual([MIN_GAP]);
    expect(dragSplit(c, 0, 5).splits).toEqual([1 - MIN_GAP]);
  });

  it("the dividers stay in order however they're dragged", () => {
    let c = makeCompare(["source", "a", "b", "c", "d", "e"]);
    for (const [k, f] of [[0, 0.99], [4, 0.01], [2, 0.5], [1, -1], [3, 2]] as const) {
      c = dragSplit(c, k, f);
      for (let i = 1; i < c.splits.length; i++) expect(c.splits[i]! - c.splits[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  });

  it("a divider that isn't there changes nothing", () => {
    const c = makeCompare(["source", "tone"]);
    expect(dragSplit(c, 3, 0.2)).toBe(c);
  });
});

describe("compare: strips follow their steps through chain edits", () => {
  it("reordering the steps keeps each strip on the same step", () => {
    const c = makeCompare(["threshold", "order"]);
    expect(pruneCompare(c, chain("order", "tone", "threshold"))).toBe(c);
    expect(compareTargets(c, chain("order", "tone", "threshold"))).toEqual([2, 0]);
  });

  it("removing a step drops its strip; the rest keep their places", () => {
    const c = makeCompare(["source", "threshold", "order"]);
    const after = pruneCompare(c, chain("tone", "order"))!;
    expect(after.bands).toEqual(["source", "order"]);
    expect(after.splits).toEqual([c.splits[1]]); // its room went to the strip before it
  });

  it("removing the only steps shown turns the comparison off", () => {
    expect(pruneCompare(makeCompare(["threshold"]), chain("tone"))).toBeNull();
  });

  it("removing a step drops its boxes too", () => {
    const c: Compare = { ...makeCompare(["source"]), boxes: [{ x: 0, y: 0, w: 0.2, h: 0.2, step: "fill" }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, step: "source" }] };
    expect(pruneCompare(c, chain("tone"))!.boxes).toEqual([c.boxes[1]]);
  });

  it("the targets the worker draws: the source, or a step's place in the chain", () => {
    expect(compareTargets(makeCompare(["source", "centerline"]), r)).toEqual(["source", 2]);
  });
});

describe("compare: reading a saved comparison", () => {
  it("reads back what was saved", () => {
    const c = dragSplit(setLayout(makeCompare(["source", "tone", "order"]), "rows"), 1, 0.8);
    expect(readCompare(JSON.parse(JSON.stringify(c)), r)).toEqual(c);
  });

  it("strips of steps that aren't in this recipe are dropped", () => {
    const c = readCompare(makeCompare(["source", "gone", "order"]), r)!;
    expect(c.bands).toEqual(["source", "order"]);
    expect(c.splits).toHaveLength(1);
  });

  it("nothing readable is no comparison", () => {
    for (const junk of [undefined, null, "cols", 3, [], { layout: "cols" }, { layout: "cols", bands: [] }, { layout: "cols", bands: ["gone"] }]) {
      expect(readCompare(junk, r)).toBeNull();
    }
  });

  it("damaged parts get their defaults: an unknown layout, crossing dividers, a bad lens, bad boxes", () => {
    const c = readCompare({ layout: "spiral", bands: ["source", "tone", 4, "order"], splits: [0.7, 0.2], lens: { x: "a" }, boxes: [{ x: 0 }, { x: 0, y: 0, w: 1, h: 1, step: "tone" }] }, r)!;
    expect(c.layout).toBe("cols");
    expect(c.bands).toEqual(["source", "tone", "order"]);
    expect(c.splits).toEqual(evenSplits(3));
    expect(c.lens).toEqual({ x: 0.5, y: 0.42, r: 0.18 });
    expect(c.boxes).toEqual([{ x: 0, y: 0, w: 1, h: 1, step: "tone" }]);
  });

  it("more than six strips: the first six", () => {
    const c = readCompare({ layout: "cols", bands: ["source", "tone", "threshold", "centerline", "order", "source", "tone"] }, r)!;
    expect(c.bands).toHaveLength(MAX_STRIPS);
  });
});

describe("compare: which worker reply a strip draws", () => {
  const view = (step: string, index: number) => ({ step, index });

  it("a reply for the strip's step at its place in the chain is drawn", () => {
    expect(stripView([view("source", -1), view("order", 3)], ["source", "order"], ["source", 3], 1)).toEqual(view("order", 3));
  });

  it("an older reply whose index now belongs to another step isn't drawn under this strip's label", () => {
    // Strip shows "order" (was at 3). Remove an earlier step: "order" is now at 2, and the
    // older reply drew "centerline" at 2. Index matches, the step doesn't.
    expect(stripView([view("source", -1), view("centerline", 2)], ["source", "order"], ["source", 2], 1)).toBeNull();
  });

  it("an older reply for the strip's step at its old place isn't drawn either (a newer run is coming)", () => {
    expect(stripView([view("order", 3)], ["order"], [2], 0)).toBeNull();
  });

  it("no reply, or a strip the reply doesn't cover, draws nothing", () => {
    expect(stripView(null, ["source"], ["source"], 0)).toBeNull();
    expect(stripView([null], ["source"], ["source"], 0)).toBeNull();
    expect(stripView([view("source", -1)], ["source", "tone"], ["source", 0], 1)).toBeNull();
  });
});

describe("compare: releasing a divider drag", () => {
  it("puts the dragged dividers on the comparison as it is now", () => {
    const now = setBand(makeCompare(["source", "tone", "order"]), 1, "threshold");
    const dragged = dragSplit(makeCompare(["source", "tone", "order"]), 0, 0.2);
    const out = applySplits(now, dragged.splits);
    expect(out.bands).toEqual(["source", "threshold", "order"]);
    expect(out.splits[0]).toBe(0.2);
  });

  it("a strip removed during the drag stays removed: the drag's dividers no longer fit and are dropped", () => {
    const dragged = dragSplit(makeCompare(["source", "tone", "order"]), 0, 0.2);
    const pruned = pruneCompare(makeCompare(["source", "tone", "order"]), chain("order"))!;
    expect(applySplits(pruned, dragged.splits)).toBe(pruned);
  });

  it("dividers that would cross aren't applied", () => {
    const c = makeCompare(["source", "tone"]);
    expect(applySplits(c, [0.9, 0.1].slice(0, 1))).toEqual({ ...c, splits: [0.9] });
    const three = makeCompare(["source", "tone", "order"]);
    expect(applySplits(three, [0.7, 0.2])).toBe(three);
  });
});

const lensOf = (bands: string[], lens = { x: 0.5, y: 0.5, r: 0.2 }): Compare => ({ ...makeCompare(bands, "lens"), lens });
const boxesOf = (under: string, ...boxes: Compare["boxes"]): Compare => ({ ...makeCompare([under], "boxes"), boxes });
const near = (o: Record<string, number | string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(6) : v]));

describe("compare: the lens", () => {
  it("drags: its centre follows the pointer", () => {
    expect(moveLens(lensOf(["source", "tone"]), 0.3, 0.6).lens).toEqual({ x: 0.3, y: 0.6, r: 0.2 });
  });

  it("stays inside the image: dragged past an edge, it stops with its rim on the edge", () => {
    expect(moveLens(lensOf(["source", "tone"]), -1, 2).lens).toEqual({ x: 0.2, y: 0.8, r: 0.2 });
  });

  it("its size is a fraction of the image's shorter side, so on a wide image it can go nearer the left and right edges", () => {
    // Twice as wide as tall: a radius of 0.2 of the height is 0.1 of the width.
    expect(near(moveLens(lensOf(["source", "tone"]), 0, 0, 2).lens)).toEqual({ x: 0.1, y: 0.2, r: 0.2 });
    expect(near(moveLens(lensOf(["source", "tone"]), 1, 1, 0.5).lens)).toEqual({ x: 0.8, y: 0.9, r: 0.2 });
  });

  it("resizes between a smallest and a largest size", () => {
    expect(resizeLens(lensOf(["source", "tone"]), 0.3).lens.r).toBe(0.3);
    expect(resizeLens(lensOf(["source", "tone"]), 0).lens.r).toBe(MIN_LENS);
    expect(resizeLens(lensOf(["source", "tone"]), 9).lens.r).toBe(MAX_LENS);
  });

  it("growing near an edge pushes the centre in, so the lens stays inside", () => {
    const c = lensOf(["source", "tone"], { x: 0.1, y: 0.9, r: 0.05 });
    expect(resizeLens(c, 0.3).lens).toEqual({ x: 0.3, y: 0.7, r: 0.3 });
  });

  it("an unchanged lens is the same comparison", () => {
    const c = lensOf(["source", "tone"]);
    expect(moveLens(c, 0.5, 0.5)).toBe(c);
    expect(resizeLens(c, 0.2)).toBe(c);
  });

  it("fitLens puts a saved lens inside an image of another shape", () => {
    expect(near(fitLens({ x: 0.05, y: 0.5, r: 0.2 }, 2))).toEqual({ x: 0.1, y: 0.5, r: 0.2 });
  });

  it("under the lens is the first step; in the lens is the second (the first again when there's only one)", () => {
    expect(shownBands(lensOf(["source", "tone", "order"]))).toEqual(["source", "tone"]);
    expect(shownBands(lensOf(["tone"]))).toEqual(["tone"]);
  });

  it("the chips pick what's under and in the lens; not the same step for both", () => {
    const c = lensOf(["source", "tone"]);
    expect(setInLens(c, "order").bands).toEqual(["source", "order"]);
    expect(setUnder(c, "threshold").bands).toEqual(["threshold", "tone"]);
    expect(setInLens(c, "source")).toBe(c);
    expect(setUnder(c, "tone")).toBe(c);
  });

  it("strips kept from side by side swap places, so switching back loses none", () => {
    const c = lensOf(["source", "tone", "threshold", "order"]);
    const d = setInLens(c, "order");
    expect(d.bands).toEqual(["source", "order", "threshold", "tone"]);
    expect(d.splits).toEqual(c.splits);
  });

  it("with only one step, picking what's in the lens adds it", () => {
    expect(setInLens(lensOf(["source"]), "tone").bands).toEqual(["source", "tone"]);
  });

  it("releasing a lens drag puts only the lens on the comparison as it is now", () => {
    const dragged = moveLens(lensOf(["source", "fill"]), 0.3, 0.3);
    const pruned = pruneCompare(lensOf(["source", "fill"]), chain("tone"))!; // Fill removed meanwhile
    const out = applyLens(pruned, dragged.lens);
    expect(out.bands).toEqual(["source"]);
    expect(out.lens).toEqual(dragged.lens);
    expect(applyLens(pruned, pruned.lens)).toBe(pruned);
  });
});

describe("compare: boxes", () => {
  it("drawing from one corner to the other makes that box, whichever way you drag", () => {
    expect(near(boxRect(0.6, 0.7, 0.2, 0.3))).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.4 });
  });

  it("a click without dragging makes a default-sized box centred on the click", () => {
    expect(near(boxRect(0.5, 0.5, 0.5, 0.5))).toEqual(near({ x: 0.5 - DEFAULT_BOX / 2, y: 0.5 - DEFAULT_BOX / 2, w: DEFAULT_BOX, h: DEFAULT_BOX }));
    // Near a corner it stays inside the image.
    expect(near(boxRect(0.99, 0.01, 0.995, 0.012))).toEqual(near({ x: 1 - DEFAULT_BOX, y: 0, w: DEFAULT_BOX, h: DEFAULT_BOX }));
  });

  it("a thin box gets the smallest size; a drag off the image stops at its edge", () => {
    expect(near(boxRect(0.2, 0.2, 0.6, 0.21))).toEqual(near({ x: 0.2, y: 0.2, w: 0.4, h: MIN_BOX }));
    expect(near(boxRect(0.5, 0.5, 3, -2))).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it("adding a box puts it at the end with its step; six boxes is the most", () => {
    const c = addBox(boxesOf("source"), { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, "tone");
    expect(c.boxes).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, step: "tone" }]);
    let six = boxesOf("source");
    for (let k = 0; k < MAX_BOXES; k++) six = addBox(six, { x: 0, y: 0, w: 0.2, h: 0.2 }, "tone");
    expect(six.boxes).toHaveLength(MAX_BOXES);
    expect(addBox(six, { x: 0, y: 0, w: 0.2, h: 0.2 }, "tone")).toBe(six);
  });

  it("moves, staying inside the image", () => {
    const c = boxesOf("source", { x: 0.1, y: 0.1, w: 0.3, h: 0.2, step: "tone" });
    expect(moveBox(c, 0, 0.4, 0.5).boxes[0]).toEqual({ x: 0.4, y: 0.5, w: 0.3, h: 0.2, step: "tone" });
    expect(near(moveBox(c, 0, 0.9, -1).boxes[0]!)).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.2, step: "tone" });
  });

  it("resizes from its bottom-right corner, not smaller than the smallest box nor past the image", () => {
    const c = boxesOf("source", { x: 0.2, y: 0.2, w: 0.3, h: 0.2, step: "tone" });
    expect(near(resizeBox(c, 0, 0.6, 0.7).boxes[0]!)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.5, step: "tone" });
    expect(near(resizeBox(c, 0, 0, 0).boxes[0]!)).toEqual({ x: 0.2, y: 0.2, w: MIN_BOX, h: MIN_BOX, step: "tone" });
    expect(near(resizeBox(c, 0, 5, 5).boxes[0]!)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8, step: "tone" });
  });

  it("is removed from its chip; its step can be changed", () => {
    const c = boxesOf("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "tone" }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, step: "order" });
    expect(removeBox(c, 0).boxes).toEqual([c.boxes[1]]);
    expect(setBoxStep(c, 1, "threshold").boxes[1]!.step).toBe("threshold");
    expect(removeBox(c, 5)).toBe(c);
    expect(setBoxStep(c, 1, "order")).toBe(c);
  });

  it("two boxes may show the same step, and a box may show the step underneath", () => {
    const c = boxesOf("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "tone" });
    expect(setBoxStep(addBox(c, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, "order"), 1, "tone").boxes.map((b) => b.step)).toEqual(["tone", "tone"]);
    expect(setBoxStep(c, 0, "source").boxes[0]!.step).toBe("source");
  });

  it("the chip under the boxes picks any step (the hidden strips swap places)", () => {
    const c = { ...makeCompare(["source", "tone"], "boxes"), boxes: [] };
    expect(setUnder(c, "tone").bands).toEqual(["tone", "source"]);
    expect(setUnder(c, "order").bands).toEqual(["order", "tone"]);
  });

  it("the steps sent are the one under the boxes and each box's step, once each", () => {
    const c = boxesOf("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "order" }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, step: "order" }, { x: 0.5, y: 0, w: 0.2, h: 0.2, step: "source" }, { x: 0, y: 0.5, w: 0.2, h: 0.2, step: "tone" });
    expect(shownBands(c)).toEqual(["source", "order", "tone"]);
    expect(compareTargets(c, r)).toEqual(["source", 3, 0]);
  });

  it("releasing a move or resize puts only that box's new place on the comparison as it is now", () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, step: "fill" };
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2, step: "order" };
    const dragged = moveBox(boxesOf("source", a, b), 1, 0.6, 0.7).boxes[1]!;
    // Fill was removed during the drag: its box is gone and the dragged one is now box 0.
    const pruned = pruneCompare(boxesOf("source", a, b), chain("order"))!;
    const out = applyBox(pruned, b, dragged);
    expect(out.boxes).toEqual([{ ...b, x: 0.6, y: 0.7 }]);
  });

  it("a box removed during the drag stays removed", () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, step: "fill" };
    const pruned = pruneCompare(boxesOf("source", a), chain("order"))!;
    expect(applyBox(pruned, a, { ...a, x: 0.5 })).toBe(pruned);
  });
});

describe("compare: shift-click on a thumbnail, per layout", () => {
  it("side by side: adds a strip, not a step already shown, at most six", () => {
    expect(shiftAdd(makeCompare(["source"]), "tone").bands).toEqual(["source", "tone"]);
    expect(shiftRefusal(makeCompare(["source", "tone"]), "tone")).toBe("That step already has a strip.");
    expect(shiftRefusal(makeCompare(["source", "tone", "threshold", "centerline", "order", "a"]), "b")).toBe("Six strips is the most.");
  });

  it("lens: sets what's in the lens (not the step under it)", () => {
    const c = lensOf(["source", "tone"]);
    expect(shiftAdd(c, "order").bands).toEqual(["source", "order"]);
    expect(shiftRefusal(c, "source")).toBe("That step is already under the lens.");
    expect(shiftRefusal(c, "tone")).toBe("That step is already in the lens.");
    expect(shiftAdd(c, "source")).toBe(c);
  });

  it("boxes: adds a default-sized box showing that step (the same step again is fine); six boxes is the most", () => {
    const c = shiftAdd(boxesOf("source"), "tone");
    expect(c.boxes).toHaveLength(1);
    expect(c.boxes[0]!.step).toBe("tone");
    expect(c.boxes[0]!.w).toBe(DEFAULT_BOX);
    const d = shiftAdd(c, "tone");
    expect(d.boxes).toHaveLength(2);
    expect(d.boxes[1]).not.toEqual({ ...c.boxes[0], step: "tone" }); // not exactly on top of the first
    expect(shiftRefusal(d, "tone")).toBeNull();
    let six = d;
    while (six.boxes.length < MAX_BOXES) six = shiftAdd(six, "order");
    expect(shiftRefusal(six, "order")).toBe("Six boxes is the most.");
    expect(shiftAdd(six, "order")).toBe(six);
  });
});

describe("compare: switching to the lens or boxes", () => {
  it("the lens needs two steps: with one, the given step goes in the lens", () => {
    expect(setLayout(makeCompare(["source"]), "lens", "tone").bands).toEqual(["source", "tone"]);
    expect(setLayout(makeCompare(["source", "order"]), "lens", "tone").bands).toEqual(["source", "order"]);
  });

  it("boxes start with one box, showing the second step (or the given step)", () => {
    const c = setLayout(makeCompare(["source", "order"]), "boxes", "tone");
    expect(c.boxes).toHaveLength(1);
    expect(c.boxes[0]!.step).toBe("order");
    expect(setLayout(makeCompare(["source"]), "boxes", "tone").boxes[0]!.step).toBe("tone");
    // Boxes already drawn stay.
    const drawn = { ...c, layout: "lens" as const };
    expect(setLayout(drawn, "boxes", "tone").boxes).toBe(c.boxes);
  });

  it("“This step vs the one before” keeps the lens where it is, and the boxes show this step", () => {
    const lens = moveLens(lensOf(["source", "order"]), 0.3, 0.3);
    const t = thisVsBefore(r, 2, "lens", lens);
    expect(t.bands).toEqual(["threshold", "centerline"]);
    expect(t.lens).toEqual(lens.lens);
    const boxes = boxesOf("source", { x: 0.1, y: 0.1, w: 0.2, h: 0.2, step: "order" });
    const u = thisVsBefore(r, 2, "boxes", boxes);
    expect(u.bands[0]).toBe("threshold");
    expect(u.boxes).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, step: "centerline" }]);
  });
});

describe("compare: lens and boxes follow their steps", () => {
  it("removing the step in the lens leaves the step under it showing; reordering changes nothing", () => {
    const c = lensOf(["source", "tone"]);
    expect(pruneCompare(c, chain("order", "tone"))).toBe(c);
    expect(shownBands(pruneCompare(c, chain("order"))!)).toEqual(["source"]);
  });

  it("the steps sent for the lens: under and in, once each, by their place in the chain", () => {
    expect(compareTargets(lensOf(["order", "tone", "threshold"]), r)).toEqual([3, 0]);
    expect(compareTargets(lensOf(["order"]), r)).toEqual([3]);
  });

  it("each part draws only a reply for its own step id at its place (bandView)", () => {
    const c = boxesOf("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "order" });
    const t = compareTargets(c, r);
    expect(bandView([{ step: "source", index: -1 }, { step: "order", index: 3 }], c, t, "order")).toEqual({ step: "order", index: 3 });
    expect(bandView([{ step: "source", index: -1 }, { step: "centerline", index: 3 }], c, t, "order")).toBeNull();
    expect(bandView([{ step: "source", index: -1 }, { step: "order", index: 3 }], c, t, "tone")).toBeNull();
  });
});

describe("compare: reading a saved lens and boxes", () => {
  it("reads back what was saved", () => {
    const c = addBox(moveLens(setLayout(makeCompare(["source", "tone"]), "lens"), 0.3, 0.6), { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, "order");
    expect(readCompare(JSON.parse(JSON.stringify(c)), r)).toEqual(c);
    const b = { ...c, layout: "boxes" as const };
    expect(readCompare(JSON.parse(JSON.stringify(b)), r)).toEqual(b);
  });

  it("a lens or box out of range is brought back inside; at most six boxes", () => {
    const c = readCompare({ layout: "boxes", bands: ["source"], lens: { x: 3, y: -1, r: 4 }, boxes: [{ x: 0.9, y: -0.5, w: 2, h: 0.001, step: "tone" }, ...Array.from({ length: 8 }, () => ({ x: 0, y: 0, w: 0.2, h: 0.2, step: "order" }))] }, r)!;
    expect(c.lens).toEqual({ x: 1, y: 0, r: MAX_LENS });
    expect(near(c.boxes[0]!)).toEqual({ x: 0, y: 0, w: 1, h: MIN_BOX, step: "tone" });
    expect(c.boxes).toHaveLength(MAX_BOXES);
  });
});
