import { describe, expect, it } from "vitest";
import { loadRecipe, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { laneProps } from "../src/laneProps.ts";
import { initialView, select, stepSelection, type ViewState } from "../src/view.ts";

const reg = createRegistry();
const recipe = (steps: string[]): Recipe =>
  loadRecipe({ schemaVersion: 4, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((step) => ({ step })) }, reg).recipe;

/** laneProps with a view and recorders for what it does. */
function wired(r: Recipe, view: ViewState) {
  const out = { view, applied: null as Recipe | null, notice: null as string | null };
  const lp = laneProps({
    recipe: r,
    registry: reg,
    run: { steps: [], staleIds: [] },
    plot: null,
    view,
    currentView: () => out.view,
    changeView: (v) => (out.view = v),
    apply: (x) => (out.applied = x),
    applySelecting: (x) => (out.applied = x),
    setNotice: (m) => (out.notice = m),
    link: () => undefined,
  });
  return { lp, out };
}

describe("Independent with a lane step selected (final review I-1)", () => {
  it("the selection moves into a lane, so the sidebar edits that ink", () => {
    const r = recipe(["cmyk", "levels", "bands", "fill", "order"]);
    const { lp, out } = wired(r, select(initialView, stepSelection("fill")));
    lp.strip.onUnlink();
    expect(out.applied).not.toBeNull();
    expect(out.view.selection).toEqual(stepSelection("fill"));
    expect(out.view.lane).toBe("C");
    // The lane shown in one-lane view wins.
    const { lp: one, out: o2 } = wired(r, { ...select(initialView, stepSelection("fill")), laneView: "M" });
    one.strip.onUnlink();
    expect(o2.view.lane).toBe("M");
  });
  it("a selection outside the lanes stays as it is", () => {
    const r = recipe(["cmyk", "levels", "bands", "fill", "order"]);
    const { lp, out } = wired(r, select(initialView, stepSelection("order")));
    lp.strip.onUnlink();
    expect(out.view.lane).toBeNull();
  });
});
