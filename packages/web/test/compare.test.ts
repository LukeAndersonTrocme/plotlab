import { describe, expect, it } from "vitest";
import { addBand, compareTargets, dragSplit, everyStep, evenSplits, makeCompare, MAX_STRIPS, MIN_GAP, pruneCompare, readCompare, removeBand, setBand, setLayout, thisVsBefore, type Compare } from "../src/compare.ts";

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
