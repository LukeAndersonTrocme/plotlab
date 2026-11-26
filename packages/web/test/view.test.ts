import { describe, expect, it } from "vitest";
import { canvasTarget, fitSelection, initialView, openSetup, RESULT, select, setMode, SOURCE, stepSelection, toggleSelect, type ViewState } from "../src/view.ts";

const at = (patch: Partial<ViewState>): ViewState => ({ ...initialView, ...patch });

describe("view state: mode", () => {
  it("starts in Design mode looking at the result", () => {
    expect(initialView.mode).toBe("design");
    expect(initialView.selection).toEqual(RESULT);
    expect(canvasTarget(initialView)).toBeNull();
  });

  it("switching mode keeps the selection for when you come back to Design", () => {
    let v = select(initialView, stepSelection(1));
    v = setMode(v, "plot");
    expect(v.mode).toBe("plot");
    v = setMode(v, "design");
    expect(v.selection).toEqual(stepSelection(1));
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
    const v = select(initialView, stepSelection(2));
    expect(v.selection).toEqual(stepSelection(2));
    expect(canvasTarget(v)).toBe(2);
    expect(canvasTarget(select(initialView, SOURCE))).toBe("source");
  });

  it("selecting from Page or Plot mode goes back to Design, where step settings are", () => {
    const v = select(at({ mode: "page" }), stepSelection(0));
    expect(v.mode).toBe("design");
    expect(canvasTarget(v)).toBe(0);
  });

  it("Page and Plot show the result, whatever is selected", () => {
    const v = select(initialView, stepSelection(1));
    expect(canvasTarget(setMode(v, "page"))).toBeNull();
    expect(canvasTarget(setMode(v, "plot"))).toBeNull();
  });

  it("toggling the selected step goes back to the result; toggling another selects it", () => {
    let v = toggleSelect(initialView, stepSelection(1));
    expect(v.selection).toEqual(stepSelection(1));
    v = toggleSelect(v, stepSelection(0));
    expect(v.selection).toEqual(stepSelection(0));
    v = toggleSelect(v, stepSelection(0));
    expect(v.selection).toEqual(RESULT);
    expect(toggleSelect(select(initialView, SOURCE), SOURCE).selection).toEqual(RESULT);
  });

  it("toggling from Page mode selects (in Design) rather than unselecting", () => {
    const v = setMode(select(initialView, stepSelection(1)), "page");
    const w = toggleSelect(v, stepSelection(1));
    expect(w.mode).toBe("design");
    expect(w.selection).toEqual(stepSelection(1));
  });

  it("a selected step that no longer exists falls back to the result", () => {
    const v = select(initialView, stepSelection(3));
    expect(fitSelection(v, 4)).toBe(v);
    expect(fitSelection(v, 3).selection).toEqual(RESULT);
    const s = select(initialView, SOURCE);
    expect(fitSelection(s, 0)).toBe(s);
  });
});
