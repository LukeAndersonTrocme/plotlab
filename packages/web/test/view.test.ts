import { describe, expect, it } from "vitest";
import { addBand, addBox, dragSplit, makeCompare, MAX_STRIPS, moveLens, setLayout, type Compare } from "../src/compare.ts";
import { clickLaneBox, showLanes, lookingBand, canvasTarget, clickBox, compareTargetsOf, readThumbSize, setCompare, toggleCompare, resizeThumbs, THUMB, writeThumbSize, fitSelection, fitView, fromViewBlock, initialView, isPinned, openSetup, pin, RESULT, select, setMode, sidebarSteps, SOURCE, stepSelection, toggleSelect, togglePin, toggleSolo, toViewBlock, unpin, VIEW_BLOCK_VERSION, type ViewState } from "../src/view.ts";

const at = (patch: Partial<ViewState>): ViewState => ({ ...initialView, ...patch });
/** Only the step ids matter to the view. */
const chain = (...ids: string[]) => ({ steps: ids.map((id) => ({ id })) });
const r = chain("threshold", "centerline", "order");

describe("view state: mode", () => {
  it("starts in Design mode looking at the result", () => {
    expect(initialView.mode).toBe("design");
    expect(initialView.selection).toEqual(RESULT);
    expect(canvasTarget(initialView, r)).toBeNull();
  });

  it("switching mode keeps the selection for when you come back to Design", () => {
    let v = select(initialView, stepSelection("centerline"));
    v = setMode(v, "plot");
    expect(v.mode).toBe("plot");
    v = setMode(v, "design");
    expect(v.selection).toEqual(stepSelection("centerline"));
  });

  it("the setup chip opens Page mode", () => {
    expect(openSetup(initialView).mode).toBe("page");
    expect(openSetup(at({ mode: "plot" })).mode).toBe("page");
  });

  it("a change that changes nothing returns the same state", () => {
    expect(setMode(initialView, "design")).toBe(initialView);
    const v = select(initialView, SOURCE);
    expect(select(v, SOURCE)).toBe(v);
  });
});

describe("view state: selection", () => {
  it("selecting a step shows its output on the canvas", () => {
    const v = select(initialView, stepSelection("order"));
    expect(v.selection).toEqual(stepSelection("order"));
    expect(canvasTarget(v, r)).toBe(2);
    expect(canvasTarget(select(initialView, SOURCE), r)).toBe("source");
  });

  it("selecting from Page or Plot mode goes back to Design, where step settings are", () => {
    const v = select(at({ mode: "page" }), stepSelection("threshold"));
    expect(v.mode).toBe("design");
    expect(canvasTarget(v, r)).toBe(0);
  });

  it("Page and Plot show the result, whatever is selected", () => {
    const v = select(initialView, stepSelection("centerline"));
    expect(canvasTarget(setMode(v, "page"), r)).toBeNull();
    expect(canvasTarget(setMode(v, "plot"), r)).toBeNull();
  });

  it("toggling the selected step goes back to the result; toggling another selects it", () => {
    let v = toggleSelect(initialView, stepSelection("centerline"));
    expect(v.selection).toEqual(stepSelection("centerline"));
    v = toggleSelect(v, stepSelection("threshold"));
    expect(v.selection).toEqual(stepSelection("threshold"));
    v = toggleSelect(v, stepSelection("threshold"));
    expect(v.selection).toEqual(RESULT);
    expect(toggleSelect(select(initialView, SOURCE), SOURCE).selection).toEqual(RESULT);
  });

  it("toggling from Page mode selects (in Design) rather than unselecting", () => {
    const v = setMode(select(initialView, stepSelection("centerline")), "page");
    const w = toggleSelect(v, stepSelection("centerline"));
    expect(w.mode).toBe("design");
    expect(w.selection).toEqual(stepSelection("centerline"));
  });

  it("a selection follows its step when the chain is reordered", () => {
    const v = select(initialView, stepSelection("order"));
    expect(canvasTarget(v, chain("order", "threshold", "centerline"))).toBe(0);
    expect(fitSelection(v, r, chain("order", "threshold", "centerline"))).toBe(v);
  });

  it("a selected step that is removed falls back to the step before it", () => {
    const v = select(initialView, stepSelection("centerline"));
    expect(fitSelection(v, r, chain("threshold", "order")).selection).toEqual(stepSelection("threshold"));
    // The step before it went too: the nearest earlier one that is left.
    const w = select(initialView, stepSelection("order"));
    expect(fitSelection(w, r, chain("threshold")).selection).toEqual(stepSelection("threshold"));
  });

  it("with nothing before it left, a removed step falls back to the result", () => {
    const v = select(initialView, stepSelection("threshold"));
    expect(fitSelection(v, r, chain("centerline", "order")).selection).toEqual(RESULT);
    expect(fitSelection(v, r, chain()).selection).toEqual(RESULT);
  });

  it("the source and the result never need fitting", () => {
    const s = select(initialView, SOURCE);
    expect(fitSelection(s, r, chain())).toBe(s);
    expect(fitSelection(initialView, r, chain())).toBe(initialView);
  });

  it("an unknown step shows the result on the canvas", () => {
    expect(canvasTarget(select(initialView, stepSelection("gone")), r)).toBeNull();
  });
});

describe("view state: strip size", () => {
  it("starts at the default size and stays within bounds", () => {
    expect(initialView.thumb).toBe(THUMB.default);
    expect(resizeThumbs(initialView, 10).thumb).toBe(THUMB.min);
    expect(resizeThumbs(initialView, 999).thumb).toBe(THUMB.max);
    expect(resizeThumbs(initialView, 120.4).thumb).toBe(120);
    expect(resizeThumbs(initialView, THUMB.default)).toBe(initialView);
  });

  it("is remembered per device (in this browser's storage)", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readThumbSize(storage)).toBe(THUMB.default);
    writeThumbSize(storage, 144);
    expect(readThumbSize(storage)).toBe(144);
    m.set([...m.keys()][0]!, "nonsense");
    expect(readThumbSize(storage)).toBe(THUMB.default);
    m.set([...m.keys()][0]!, "5000");
    expect(readThumbSize(storage)).toBe(THUMB.max);
  });

  it("storage that is missing or throws doesn't break anything", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readThumbSize(broken)).toBe(THUMB.default);
    expect(() => writeThumbSize(broken, 120)).not.toThrow();
    expect(readThumbSize(null)).toBe(THUMB.default);
  });
});

describe("view state: pinned steps", () => {
  it("starts with nothing pinned; pinning and unpinning a step", () => {
    expect(initialView.pins).toEqual([]);
    const v = pin(initialView, "centerline");
    expect(isPinned(v, "centerline")).toBe(true);
    expect(isPinned(v, "order")).toBe(false);
    expect(pin(v, "centerline")).toBe(v);
    expect(unpin(v, "centerline").pins).toEqual([]);
    expect(unpin(initialView, "centerline")).toBe(initialView);
    expect(togglePin(togglePin(initialView, "order"), "order").pins).toEqual([]);
  });

  it("pinning changes only the pins: not the mode, the selection or the strip size", () => {
    const v = select(initialView, stepSelection("threshold"));
    const w = pin(v, "order");
    expect({ ...w, pins: v.pins }).toEqual(v);
  });

  it("the sidebar: the step you're looking at on top, then the pinned ones in recipe order", () => {
    let v = pin(pin(initialView, "order"), "threshold");
    v = select(v, stepSelection("centerline"));
    expect(sidebarSteps(v, r)).toEqual({ looking: "centerline", pinned: ["threshold", "order"], lookingPinned: false });
  });

  it("the step you're looking at stays on top even when it is pinned, and isn't shown twice", () => {
    let v = pin(pin(initialView, "order"), "threshold");
    v = select(v, stepSelection("order"));
    expect(sidebarSteps(v, r)).toEqual({ looking: "order", pinned: ["threshold"], lookingPinned: true });
  });

  it("looking at the source or the result: the pinned steps alone", () => {
    const v = pin(initialView, "centerline");
    expect(sidebarSteps(select(v, SOURCE), r)).toEqual({ looking: null, pinned: ["centerline"], lookingPinned: false });
    expect(sidebarSteps(v, r)).toEqual({ looking: null, pinned: ["centerline"], lookingPinned: false });
  });

  it("follows its step when the chain is reordered", () => {
    const v = pin(pin(initialView, "threshold"), "order");
    const moved = chain("order", "threshold", "centerline");
    expect(fitView(v, r, moved)).toBe(v);
    expect(sidebarSteps(v, moved).pinned).toEqual(["order", "threshold"]);
  });

  it("removing a step removes its pin, so a new step given the same id later isn't pinned", () => {
    const v = pin(pin(initialView, "centerline"), "order");
    const removed = fitView(v, r, chain("threshold", "order"));
    expect(removed.pins).toEqual(["order"]);
    // A new Centerline added later gets the id "centerline" again (the engine reuses free ids).
    expect(isPinned(fitView(removed, chain("threshold", "order"), r), "centerline")).toBe(false);
  });

  it("fitting after a chain edit also fits the selection", () => {
    const v = pin(select(initialView, stepSelection("centerline")), "centerline");
    const w = fitView(v, r, chain("threshold", "order"));
    expect(w.selection).toEqual(stepSelection("threshold"));
    expect(w.pins).toEqual([]);
  });
});

describe("view block (saved per project, beside recipe.json)", () => {
  it("holds the pins, with a version", () => {
    const block = toViewBlock(pin(pin(initialView, "order"), "threshold"));
    expect(block).toEqual({ version: VIEW_BLOCK_VERSION, pins: ["order", "threshold"], compare: null });
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });

  it("doesn't hold the selection, the mode or the strip size", () => {
    const v = resizeThumbs(setMode(select(initialView, stepSelection("order")), "plot"), 150);
    expect(Object.keys(toViewBlock(v)).sort()).toEqual(["compare", "pins", "version"]);
  });

  it("reading it back restores the pins of steps that are still in the recipe", () => {
    const block = toViewBlock(pin(pin(initialView, "order"), "gone"));
    expect(fromViewBlock(initialView, block, r).pins).toEqual(["order"]);
  });

  it("anything unreadable is ignored: no block, junk, or pins that aren't step ids", () => {
    expect(fromViewBlock(initialView, undefined, r)).toBe(initialView);
    expect(fromViewBlock(initialView, "nonsense", r)).toBe(initialView);
    expect(fromViewBlock(initialView, { version: 1, pins: "order" }, r)).toBe(initialView);
    expect(fromViewBlock(initialView, { version: 1, pins: ["order", 3, null] }, r).pins).toEqual(["order"]);
  });

  it("reading replaces the pins of the previous project", () => {
    const v = pin(initialView, "threshold");
    expect(fromViewBlock(v, { version: 1, pins: ["order"] }, r).pins).toEqual(["order"]);
    expect(fromViewBlock(v, undefined, r).pins).toEqual([]);
  });

  it("keeps what a newer build saved that this one doesn't know, and still reads the pins", () => {
    const newer = { version: VIEW_BLOCK_VERSION + 1, pins: ["order"], compare: null, zoom: { x: 0.2, k: 3 } };
    const v = fromViewBlock(initialView, newer, r);
    expect(v.pins).toEqual(["order"]);
    expect(toViewBlock(unpin(v, "order"), newer)).toEqual({ ...newer, pins: [] });
  });
});

describe("view state: one pen in Plot mode", () => {
  it("clicking a pen box shows only that pen; clicking it again (or All) shows every pen", () => {
    let v = toggleSolo(at({ mode: "plot" }), "dark");
    expect(v.solo).toBe("dark");
    expect(toggleSolo(v, "dark").solo).toBeNull();
    expect(toggleSolo(v, "light").solo).toBe("light");
    v = toggleSolo(v, null);
    expect(v.solo).toBeNull();
    expect(toggleSolo(v, null)).toBe(v);
  });

  it("leaving Plot mode goes back to every pen", () => {
    const v = toggleSolo(at({ mode: "plot" }), "dark");
    expect(setMode(v, "design").solo).toBeNull();
    expect(setMode(v, "plot")).toBe(v);
  });

  it("isn't saved with the project, and doesn't change what the worker draws", () => {
    const v = toggleSolo(at({ mode: "plot" }), "dark");
    expect(Object.keys(toViewBlock(v)).sort()).toEqual(["compare", "pins", "version"]);
    expect(canvasTarget(v, r)).toBeNull();
  });
});

describe("view state: compare stages", () => {
  const comparing = (bands: string[], patch: Partial<ViewState> = {}) => at({ compare: makeCompare(bands), ...patch });

  it("starts off, and isn't part of the selection", () => {
    expect(initialView.compare).toBeNull();
    expect(compareTargetsOf(initialView, r)).toBeNull();
  });

  it("turning it on compares the selected step with the one before; off again clears it", () => {
    const v = toggleCompare(select(initialView, stepSelection("centerline")), r);
    expect(v.compare!.bands).toEqual(["threshold", "centerline"]);
    expect(toggleCompare(v, r).compare).toBeNull();
  });

  it("turning it on with the first step selected compares it with the source", () => {
    expect(toggleCompare(select(initialView, stepSelection("threshold")), r).compare!.bands).toEqual(["source", "threshold"]);
  });

  it("is a view change, not a recipe edit: it leaves the mode, selection, pins and strip size alone", () => {
    const v = pin(select(initialView, stepSelection("order")), "order");
    const w = toggleCompare(v, r);
    expect({ ...w, compare: null }).toEqual(v);
  });

  it("while comparing the canvas draws the strips: no single stage, and the strips' targets follow their steps", () => {
    const v = comparing(["source", "order"], { selection: stepSelection("threshold") });
    expect(canvasTarget(v, r)).toBeNull();
    expect(compareTargetsOf(v, r)).toEqual(["source", 2]);
    expect(compareTargetsOf(v, chain("order", "threshold"))).toEqual(["source", 0]);
  });

  it("only Design mode compares (Page and Plot show the result); coming back to Design compares again", () => {
    const v = comparing(["source", "order"]);
    expect(compareTargetsOf(setMode(v, "plot"), r)).toBeNull();
    expect(compareTargetsOf(setMode(setMode(v, "plot"), "design"), r)).toEqual(["source", 2]);
  });

  it("not comparing: clicking a thumbnail selects it, with or without shift", () => {
    expect(clickBox(initialView, stepSelection("order"), false).selection).toEqual(stepSelection("order"));
    expect(clickBox(initialView, stepSelection("order"), true)).toEqual(select(initialView, stepSelection("order")));
  });

  it("while comparing, clicking a thumbnail only changes the sidebar: the strips stay as they are", () => {
    const v = comparing(["source", "order"]);
    const w = clickBox(v, stepSelection("threshold"), false);
    expect(w.selection).toEqual(stepSelection("threshold"));
    expect(w.compare).toBe(v.compare);
  });

  it("while comparing, shift-click adds that step as a strip and leaves the sidebar alone", () => {
    const v = comparing(["source", "order"], { selection: stepSelection("order") });
    const w = clickBox(v, stepSelection("threshold"), true);
    expect(w.compare!.bands).toEqual(["source", "order", "threshold"]);
    expect(w.selection).toEqual(stepSelection("order"));
    expect(clickBox(comparing(["order"]), SOURCE, true).compare!.bands).toEqual(["order", "source"]);
  });

  it("shift-click on a step that already has a strip, or with six strips, changes nothing", () => {
    const v = comparing(["source", "order"]);
    expect(clickBox(v, stepSelection("order"), true)).toBe(v);
    const six = comparing(["source", "threshold", "centerline", "order", "source", "order"]);
    expect(six.compare!.bands).toHaveLength(MAX_STRIPS);
    expect(clickBox(six, stepSelection("threshold"), true)).toBe(six);
  });

  it("the result box can't be a strip: shift-clicking it just selects", () => {
    const v = comparing(["source", "order"]);
    expect(clickBox(v, RESULT, true).compare).toBe(v.compare);
  });

  it("reordering the steps keeps the strips on the same steps", () => {
    const v = comparing(["threshold", "order"]);
    expect(fitView(v, r, chain("order", "centerline", "threshold"))).toBe(v);
  });

  it("removing a step drops its strip; removing every compared step turns comparing off", () => {
    const v = comparing(["source", "centerline", "order"]);
    expect(fitView(v, r, chain("threshold", "order")).compare!.bands).toEqual(["source", "order"]);
    expect(fitView(comparing(["centerline"]), r, chain("threshold", "order")).compare).toBeNull();
  });

  it("a step added later with a removed step's id (Fill removed, Fill added: \"fill\" again) doesn't get its strip back", () => {
    const withFill = chain("threshold", "fill", "order");
    const v = comparing(["source", "fill", "order"]);
    const removed = fitView(v, withFill, chain("threshold", "order"));
    const readded = fitView(removed, chain("threshold", "order"), withFill);
    expect(readded.compare!.bands).toEqual(["source", "order"]);
  });

  it("setCompare returns the same state when nothing changes", () => {
    const v = comparing(["source", "order"]);
    expect(setCompare(v, v.compare)).toBe(v);
    expect(setCompare(v, addBand(v.compare!, "threshold")).compare!.bands).toHaveLength(3);
  });

  it("the comparison is saved in the view block and read back for this recipe", () => {
    const c = dragSplit(setLayout(makeCompare(["source", "threshold", "order"]), "rows"), 0, 0.2);
    const block = JSON.parse(JSON.stringify(toViewBlock(at({ compare: c }))));
    expect(block.compare).toEqual(c);
    expect(fromViewBlock(initialView, block, r).compare).toEqual(c);
    // Read for a recipe without Threshold: that strip is dropped.
    expect(fromViewBlock(initialView, block, chain("order")).compare!.bands).toEqual(["source", "order"]);
  });

  it("another project's block replaces the comparison; no comparison saved means none", () => {
    const v = comparing(["source", "order"]);
    expect(fromViewBlock(v, { version: 1, pins: [] }, r).compare).toBeNull();
    expect(fromViewBlock(v, undefined, r).compare).toBeNull();
    expect(fromViewBlock(v, { version: 1, pins: [], compare: makeCompare(["threshold"]) }, r).compare!.bands).toEqual(["threshold"]);
  });

  it("reading the same block again changes nothing", () => {
    const block = toViewBlock(comparing(["source", "order"]));
    const v = fromViewBlock(initialView, block, r);
    expect(fromViewBlock(v, block, r)).toBe(v);
  });
});

describe("view state: the lens and boxes", () => {
  const lens = (bands: string[]): ViewState => at({ compare: { ...makeCompare(bands, "lens"), lens: { x: 0.4, y: 0.5, r: 0.2 } } });
  const boxes = (under: string, ...b: Compare["boxes"]): ViewState => at({ compare: { ...makeCompare([under], "boxes"), boxes: b } });

  it("shift-click in the lens layout sets what's in the lens; the sidebar stays", () => {
    const v = lens(["source", "order"]);
    const w = clickBox(v, stepSelection("threshold"), true);
    expect(w.compare!.bands).toEqual(["source", "threshold"]);
    expect(w.selection).toEqual(v.selection);
    expect(clickBox(v, SOURCE, true)).toBe(v); // already under the lens
  });

  it("shift-click in the boxes layout adds a box showing that step", () => {
    const w = clickBox(boxes("source"), stepSelection("order"), true);
    expect(w.compare!.boxes.map((b) => b.step)).toEqual(["order"]);
  });

  it("a plain click in either layout only changes the sidebar", () => {
    const v = boxes("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "order" });
    expect(clickBox(v, stepSelection("threshold"), false).compare).toBe(v.compare);
  });

  it("a box draws the step being looked at: the selected step, the source, or (for the result) the last step", () => {
    expect(lookingBand(at({ selection: stepSelection("centerline") }), r)).toBe("centerline");
    expect(lookingBand(at({ selection: SOURCE }), r)).toBe("source");
    expect(lookingBand(initialView, r)).toBe("order");
    expect(lookingBand(initialView, chain())).toBe("source");
  });

  it("a step added later with a removed step's id doesn't get its box back", () => {
    const withFill = chain("threshold", "fill", "order");
    const v = boxes("source", { x: 0, y: 0, w: 0.2, h: 0.2, step: "fill" }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, step: "order" });
    const removed = fitView(v, withFill, chain("threshold", "order"));
    const readded = fitView(removed, chain("threshold", "order"), withFill);
    expect(readded.compare!.boxes.map((b) => b.step)).toEqual(["order"]);
    expect(compareTargetsOf(readded, withFill)).toEqual(["source", 2]);
  });

  it("a step added later with a removed step's id isn't put back in the lens", () => {
    const withFill = chain("threshold", "fill", "order");
    const removed = fitView(lens(["source", "fill"]), withFill, chain("threshold", "order"));
    const readded = fitView(removed, chain("threshold", "order"), withFill);
    expect(readded.compare!.bands).toEqual(["source"]);
    expect(compareTargetsOf(readded, withFill)).toEqual(["source"]);
  });

  it("the lens and boxes are saved in the view block and read back as they were", () => {
    const c = addBox(moveLens(setLayout(makeCompare(["source", "threshold"]), "lens"), 0.25, 0.7), { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, "order");
    for (const shown of [c, { ...c, layout: "boxes" as const }]) {
      const block = JSON.parse(JSON.stringify(toViewBlock(at({ compare: shown }))));
      expect(fromViewBlock(initialView, block, r).compare).toEqual(shown);
    }
  });
});

describe("view state: CMYK lanes (Independent inks)", () => {
  it("starts with every lane showing and no lane picked", () => {
    expect(initialView.laneView).toBe("all");
    expect(initialView.lane).toBeNull();
  });
  it("a tab shows one lane (and that ink's settings); All lanes shows every lane again", () => {
    const one = showLanes(initialView, "M");
    expect(one).toMatchObject({ laneView: "M", lane: "M" });
    expect(showLanes(one, "all")).toMatchObject({ laneView: "all", lane: "M" });
    expect(showLanes(one, "M")).toBe(one);
  });
  it("a box in a lane selects that step for that ink; clicking it again goes back to the result", () => {
    const v = clickLaneBox(initialView, "centerline", "Y");
    expect(v).toMatchObject({ selection: stepSelection("centerline"), lane: "Y" });
    // The same step in another lane is another box.
    expect(clickLaneBox(v, "centerline", "C")).toMatchObject({ selection: stepSelection("centerline"), lane: "C" });
    expect(clickLaneBox(v, "centerline", "Y")).toMatchObject({ selection: RESULT, lane: null });
  });
  it("picking anything outside the lanes forgets the lane", () => {
    const v = clickLaneBox(initialView, "centerline", "Y");
    expect(select(v, SOURCE).lane).toBeNull();
    expect(select(v, stepSelection("centerline")).lane).toBe("Y");
  });
  it("is only the view: not saved in the view block", () => {
    expect(Object.keys(toViewBlock(clickLaneBox(showLanes(initialView, "M"), "centerline", "M")))).toEqual(["version", "pins", "compare"]);
  });
});
