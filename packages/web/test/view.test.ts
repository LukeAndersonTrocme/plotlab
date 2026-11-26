import { describe, expect, it } from "vitest";
import { canvasTarget, readThumbSize, resizeThumbs, THUMB, writeThumbSize, fitSelection, initialView, openSetup, RESULT, select, setMode, SOURCE, stepSelection, toggleSelect, type ViewState } from "../src/view.ts";

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
