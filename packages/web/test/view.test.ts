import { describe, expect, it } from "vitest";
import { canvasTarget, readThumbSize, resizeThumbs, THUMB, writeThumbSize, fitSelection, fitView, fromViewBlock, initialView, isPinned, openSetup, pin, RESULT, select, setMode, sidebarSteps, SOURCE, stepSelection, toggleSelect, togglePin, toggleSolo, toViewBlock, unpin, VIEW_BLOCK_VERSION, type ViewState } from "../src/view.ts";

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
    expect(block).toEqual({ version: VIEW_BLOCK_VERSION, pins: ["order", "threshold"] });
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });

  it("doesn't hold the selection, the mode or the strip size", () => {
    const v = resizeThumbs(setMode(select(initialView, stepSelection("order")), "plot"), 150);
    expect(Object.keys(toViewBlock(v)).sort()).toEqual(["pins", "version"]);
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

  it("keeps what a newer build saved that this one doesn't know (a later comparison), and still reads the pins", () => {
    const newer = { version: VIEW_BLOCK_VERSION + 1, pins: ["order"], compare: { layout: "cols", bands: ["source", "order"] } };
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
    expect(Object.keys(toViewBlock(v)).sort()).toEqual(["pins", "version"]);
    expect(canvasTarget(v, r)).toBeNull();
  });
});
