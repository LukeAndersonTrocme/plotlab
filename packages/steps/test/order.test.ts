import { describe, expect, it } from "vitest";
import { createRng, type Position } from "@plotlab/engine";
import { applyStep, type Geometry, type Ink, type Plot, type StepContext } from "@plotlab/engine";
import { orderPaths, singleStroke, travelLength } from "../src/order/sort.ts";
import { order } from "../src/index.ts";

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


describe("single stroke", () => {
  const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.3 };
  const ctx: StepContext = { paper: { widthMm: 300, heightMm: 300 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: ["a", "b"] };
  const taps = Array.from({ length: 300 }, (_, i) => { const r = createRng(i + 1); const p: Position = [r() * 200, r() * 200]; return [p, p]; });
  const lines = randomStrokes(200, 200, 3);
  const geo: Geometry = {
    kind: "geometry",
    paper: ctx.paper,
    layers: [
      { id: "a", name: "Dots", features: { type: "FeatureCollection", features: taps.map((coordinates) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} })) } },
      { id: "b", name: "Lines", features: { type: "FeatureCollection", features: lines.map((coordinates) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} })) } },
    ],
  };
  const run = async (params: Record<string, unknown>) => (await applyStep(order, geo, { params: { allowReverse: true, improve: true, ...params } }, ctx)) as Plot;
  const pts = (ps: Position[][]) => new Set(ps.flat().map((q) => `${q[0]},${q[1]}`));

  it("joins each layer into exactly one stroke that visits every point", async () => {
    const out = await run({ method: "single" });
    expect(out.layers.map((l) => l.paths.length)).toEqual([1, 1]);
    expect(pts(out.layers[0]!.paths)).toEqual(pts(taps));
    expect(pts(out.layers[1]!.paths)).toEqual(pts(lines));
  });
  it("draws every original stroke as an unbroken run (forwards or backwards)", () => {
    const one = singleStroke(lines)[0]!;
    const s = JSON.stringify(one).slice(1, -1);
    for (const p of lines) {
      const f = JSON.stringify(p).slice(1, -1), b = JSON.stringify([...p].reverse()).slice(1, -1);
      expect(s.includes(f) || s.includes(b)).toBe(true);
    }
  });
  it("merges a pen tap into the line instead of repeating its point", () => {
    expect(singleStroke([[[0, 0], [0, 0]], [[1, 0], [1, 0]]])).toEqual([[[0, 0], [1, 0]]]);
  });
  it("empty layers stay empty", () => {
    expect(singleStroke([])).toEqual([]);
  });
  it("default (nearest) mode is unchanged: same strokes as orderPaths", async () => {
    const out = await run({ method: "nearest" });
    expect(out.layers[1]!.paths).toEqual(orderPaths(lines, { allowReverse: true, improve: true }));
    expect(order.params.method.default).toBe("nearest");
  });
});
