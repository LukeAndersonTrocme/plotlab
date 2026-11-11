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
