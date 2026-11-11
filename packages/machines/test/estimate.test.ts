import { describe, expect, it } from "vitest";
import { estimateLayer, getMachine, moveTime } from "../src/index.ts";

describe("moveTime", () => {
  it("trapezoid: long move ≈ d/v plus acceleration overhead", () => {
    // 1000 mm at 100 mm/s, a = 1000: accel phase 0.1 s each end, 5 mm each.
    expect(moveTime(1000, 100, 1000)).toBeCloseTo(0.2 + 990 / 100, 6);
  });
  it("triangle: short move never reaches vMax", () => {
    expect(moveTime(1, 100, 1000)).toBeCloseTo(2 * Math.sqrt(1 / 1000), 6);
  });
  it("zero-length move is free", () => expect(moveTime(0, 100, 1000)).toBe(0));
});

describe("estimateLayer", () => {
  it("counts draw and travel lengths", () => {
    const e = estimateLayer([[[10, 0], [20, 0]]], getMachine("generic"));
    expect(e.drawLengthMm).toBeCloseTo(10);
    expect(e.travelLengthMm).toBeCloseTo(30); // 10 out, 20 home
    expect(e.timeS).toBeGreaterThan(0);
  });
});

describe("estimatePlot", () => {
  it("sums passes and counts pen changes between them", async () => {
    const { estimatePlot } = await import("../src/index.ts");
    const m = getMachine("generic");
    const ink = { id: "k", name: "k", color: "#000", mix: "multiply" as const, widthMm: 0.5 };
    const layer = (id: string) => ({ id, name: id, ink, paths: [[[10, 0], [20, 0]] as [number, number][]] });
    const e = estimatePlot({ kind: "plot", paper: { widthMm: 100, heightMm: 100 }, layers: [layer("a"), layer("b")], ordered: true }, m);
    expect(e.passes).toHaveLength(2);
    expect(e.penChanges).toBe(1);
    expect(e.totalS).toBeCloseTo(e.passes[0]!.timeS + e.passes[1]!.timeS + m.pen.changeS);
  });
});
