import { describe, expect, it } from "vitest";
import { createRng, type Position } from "@plotlab/engine";
import { orderPaths, travelLength } from "../src/order/sort.ts";

function randomStrokes(n: number, size: number, seed = 1): Position[][] {
  const r = createRng(seed);
  return Array.from({ length: n }, () => {
    const x = r() * size, y = r() * size;
    return [[x, y], [x + r() * 6 - 3, y + r() * 6 - 3]] as Position[];
  });
}
const key = (p: Position[]) => {
  const f = JSON.stringify(p), b = JSON.stringify([...p].reverse());
  return f < b ? f : b;
};
const multiset = (ps: Position[][]) => ps.map(key).sort();

describe("orderPaths", () => {
  const strokes = randomStrokes(2000, 300);
  it("keeps every stroke exactly once", () => {
    expect(multiset(orderPaths(strokes, { allowReverse: true, improve: true }))).toEqual(multiset(strokes));
  });
  it("travels less than the traced order", () => {
    expect(travelLength(orderPaths(strokes, { allowReverse: true, improve: false }))).toBeLessThan(travelLength(strokes) / 5);
  });
  it("2-opt never makes travel worse", () => {
    const greedy = travelLength(orderPaths(strokes, { allowReverse: true, improve: false }));
    const improved = travelLength(orderPaths(strokes, { allowReverse: true, improve: true }));
    expect(improved).toBeLessThanOrEqual(greedy);
    expect(improved).toBeLessThan(greedy * 0.99);
  });
  it("never reverses strokes when not allowed", () => {
    const allowed = new Set(strokes.map((p) => JSON.stringify(p)));
    for (const p of orderPaths(strokes, { allowReverse: false, improve: true })) expect(allowed.has(JSON.stringify(p))).toBe(true);
  });
  it("reverses a stroke when its far end is closer", () => {
    const out = orderPaths([[[50, 0], [100, 0]], [[10, 0], [1, 0]]], { allowReverse: true, improve: false });
    expect(out[0]).toEqual([[1, 0], [10, 0]]);
  });
  it("handles no strokes and empty strokes", () => {
    expect(orderPaths([], { allowReverse: true, improve: true })).toEqual([]);
    expect(orderPaths([[]], { allowReverse: true, improve: true })).toEqual([]);
  });
  // Budgets are loose: shared CI runners are 2-3x slower than a laptop. They only need to
  // catch the old quadratic behaviour (26 s), not small slowdowns.
  it("orders 50 000 strokes in well under the old 26 s", () => {
    const big = randomStrokes(50000, 300, 7);
    const t0 = performance.now();
    orderPaths(big, { allowReverse: true, improve: true });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
  it("stays fast when every stroke lies on almost the same line", () => {
    const flat = Array.from({ length: 20000 }, (_, i) => [[i * 0.01, (i % 7) * 1e-10], [i * 0.01 + 0.005, (i % 5) * 1e-10]] as Position[]);
    const t0 = performance.now();
    expect(orderPaths(flat, { allowReverse: true, improve: true })).toHaveLength(20000);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

