import { describe, expect, it } from "vitest";
import { budgetCheck, estimateLayer, getMachine, type PassEstimate, type PlotEstimate } from "../src/index.ts";

/** A one-pass estimate with the given time split (seconds), plus pen changes at 60 s each. */
function est(parts: { drawS?: number; travelS?: number; penS?: number }, penChanges = 0, changeS = 60): PlotEstimate {
  const pass: PassEstimate = { layerId: "a", drawLengthMm: 0, travelLengthMm: 0, drawS: parts.drawS ?? 0, travelS: parts.travelS ?? 0, penS: parts.penS ?? 0, timeS: 0 };
  pass.timeS = pass.drawS + pass.travelS + pass.penS;
  return { passes: [pass], penChanges, penChangeS: penChanges * changeS, totalS: pass.timeS + penChanges * changeS };
}

describe("estimatePlot time split", () => {
  it("matches the estimate from before the split, and the parts add up to it", async () => {
    const { estimatePlot, timeBreakdown } = await import("../src/index.ts");
    const m = getMachine("generic");
    const ink = (id: string, color: string) => ({ id, name: id, color, mix: "multiply" as const, widthMm: 0.5 });
    const plot = {
      kind: "plot" as const,
      paper: { widthMm: 200, heightMm: 150 },
      ordered: true,
      layers: [
        { id: "a", name: "a", ink: ink("a", "#c33"), paths: [[[10, 10], [60, 10], [60, 40]], [[100, 20], [101, 21]]] as [number, number][][] },
        { id: "b", name: "b", ink: ink("b", "#000"), paths: [[[150, 100], [20, 130], [40, 140], [45, 141]]] as [number, number][][] },
      ],
    };
    const e = estimatePlot(plot, m);
    // Computed with main's estimatePlot (before the time split) for this plot.
    expect(e.passes.map((p) => p.timeS)).toEqual(EXPECTED_PASS_S.map((x) => expect.closeTo(x, 9)));
    expect(e.totalS).toBeCloseTo(EXPECTED_TOTAL_S, 9);
    const parts = timeBreakdown(e);
    expect(parts.draw + parts.travel + parts.pen + parts.penChanges).toBeCloseTo(EXPECTED_TOTAL_S, 9);
  });
});

describe("estimatePlot", () => {
  it("reports the time spent on pen changes", async () => {
    const { estimatePlot } = await import("../src/index.ts");
    const m = getMachine("generic");
    const ink = { id: "k", name: "k", color: "#000", mix: "multiply" as const, widthMm: 0.5 };
    const layer = (id: string) => ({ id, name: id, ink, paths: [[[10, 0], [20, 0]] as [number, number][]] });
    const e = estimatePlot({ kind: "plot", paper: { widthMm: 100, heightMm: 100 }, layers: [layer("a"), layer("b"), layer("c")], ordered: true }, m);
    expect(e.penChangeS).toBe(2 * m.pen.changeS);
  });
});

describe("budgetCheck", () => {
  it("shows the budget as entered", () => {
    expect(budgetCheck(est({ drawS: 1e6 }), 1234).message).toMatch(/the 1234 min budget/);
    expect(budgetCheck(est({ drawS: 1e6 }), 12.25).message).toMatch(/the 12.25 min budget/);
    expect(budgetCheck(est({ drawS: 1 }), 0.5).message).toMatch(/the 0.5 min budget/);
  });
  it("never says 0% of the budget", () => {
    expect(budgetCheck(est({ drawS: 1 }), 600).message).toMatch(/\(<1%\)/);
  });
  it("under budget: not over, ratio below 1", () => {
    const c = budgetCheck(est({ drawS: 120 }), 5);
    expect(c.over).toBe(false);
    expect(c.ratio).toBeCloseTo(0.4);
    expect(c.message).toMatch(/within/i);
  });
  it("exactly at the budget is not over", () => {
    const c = budgetCheck(est({ drawS: 300 }), 5);
    expect(c.over).toBe(false);
    expect(c.ratio).toBe(1);
  });
  it("over budget: says by how much", () => {
    const c = budgetCheck(est({ drawS: 420 }), 5);
    expect(c.over).toBe(true);
    expect(c.ratio).toBeCloseTo(1.4);
    expect(c.message).toMatch(/40% over/);
    expect(c.message).toMatch(/5 min budget/);
  });
  it("very far over reads as a multiple", () => {
    expect(budgetCheck(est({ drawS: 1500 }), 5).message).toMatch(/5× the 5 min budget/);
  });

  it("suggests the fix for the biggest time component", () => {
    const drawing = budgetCheck(est({ drawS: 400, travelS: 100, penS: 50 }), 5);
    expect(drawing.dominant).toBe("draw");
    expect(drawing.message).toMatch(/drawing/);
    expect(drawing.message).toMatch(/spacing|bands/);

    const travel = budgetCheck(est({ drawS: 100, travelS: 400, penS: 50 }), 5);
    expect(travel.dominant).toBe("travel");
    expect(travel.message).toMatch(/travel/);
    expect(travel.message).toMatch(/Stroke order/);

    const lifts = budgetCheck(est({ drawS: 100, travelS: 100, penS: 400 }), 5);
    expect(lifts.dominant).toBe("pen");
    expect(lifts.message).toMatch(/lifting/);
    expect(lifts.message).toMatch(/fewer, longer strokes/);

    const changes = budgetCheck(est({ drawS: 60, travelS: 30 }, 3), 2);
    expect(changes.dominant).toBe("penChanges");
    expect(changes.message).toMatch(/pen changes/);
    expect(changes.message).toMatch(/fewer inks/);
  });

  it("no suggestion when within budget", () => {
    const c = budgetCheck(est({ drawS: 100, travelS: 50 }), 5);
    expect(c.message).not.toMatch(/try|add/i);
  });
});

// main's estimatePlot (before the time split), generic machine, the plot in "estimatePlot time split".
const EXPECTED_PASS_S = [4.404335095321299, 7.35641116804408];
const EXPECTED_TOTAL_S = 71.76074626336538;
