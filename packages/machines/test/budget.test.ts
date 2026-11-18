import { describe, expect, it } from "vitest";
import { budgetCheck, estimateLayer, getMachine, type PassEstimate, type PlotEstimate } from "../src/index.ts";

/** A one-pass estimate with the given time split (seconds), plus pen changes at 60 s each. */
function est(parts: { drawS?: number; travelS?: number; penS?: number }, penChanges = 0, changeS = 60): PlotEstimate {
  const pass: PassEstimate = { layerId: "a", drawLengthMm: 0, travelLengthMm: 0, drawS: parts.drawS ?? 0, travelS: parts.travelS ?? 0, penS: parts.penS ?? 0, timeS: 0 };
  pass.timeS = pass.drawS + pass.travelS + pass.penS;
  return { passes: [pass], penChanges, penChangeS: penChanges * changeS, totalS: pass.timeS + penChanges * changeS };
}

describe("estimateLayer time split", () => {
  it("draw + travel + pen lifts add up to the layer time", () => {
    const e = estimateLayer([[[10, 0], [20, 0], [20, 10]], [[50, 50], [60, 60]]], getMachine("generic"));
    expect(e.drawS).toBeGreaterThan(0);
    expect(e.travelS).toBeGreaterThan(0);
    expect(e.penS).toBeCloseTo(2 * (0.15 + 0.15));
    expect(e.drawS + e.travelS + e.penS).toBeCloseTo(e.timeS, 9);
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
