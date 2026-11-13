import { describe, expect, it } from "vitest";
import { maskContours, maskPolygons, ringArea } from "../src/bands/trace.ts";

const mask = (w: number, h: number, f: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0;
  return m;
};

describe("maskPolygons", () => {
  it("a filled square becomes one ring with cut corners", () => {
    const ps = maskPolygons(mask(7, 7, (x, y) => x >= 2 && x < 5 && y >= 2 && y < 5), 7, 7);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toHaveLength(1);
    const a = ringArea(ps[0]![0]!);
    expect(a).toBeGreaterThan(7);
    expect(a).toBeLessThan(9);
  });
  it("a square with a hole keeps the hole as a second ring of opposite orientation", () => {
    const ps = maskPolygons(mask(9, 9, (x, y) => x >= 1 && x < 8 && y >= 1 && y < 8 && !(x >= 3 && x < 6 && y >= 3 && y < 6)), 9, 9);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toHaveLength(2);
    expect(Math.sign(ringArea(ps[0]![0]!))).toBe(1);
    expect(Math.sign(ringArea(ps[0]![1]!))).toBe(-1);
  });
  it("separate blobs are separate polygons", () => {
    expect(maskPolygons(mask(10, 4, (x, y) => y >= 1 && y < 3 && (x === 1 || x === 2 || x === 7 || x === 8)), 10, 4)).toHaveLength(2);
  });
  it("a shape touching the edge still closes, along the image edge", () => {
    const ps = maskPolygons(mask(4, 4, () => true), 4, 4);
    expect(ps).toHaveLength(1);
    const xs = ps[0]![0]!.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(4);
  });
  it("diagonal touching pixels stay separate (saddle = separate)", () => {
    expect(maskPolygons(mask(4, 4, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2)), 4, 4)).toHaveLength(2);
  });
});

describe("maskContours", () => {
  it("a left-half mask gives one vertical line and no lines along the border", () => {
    const ls = maskContours(mask(6, 6, (x) => x < 3), 6, 6);
    expect(ls).toHaveLength(1);
    for (const [x] of ls[0]!) expect(x).toBe(3);
  });
  it("handles very long rings (big, ragged shapes)", () => {
    const w = 3000, h = 200;
    // A comb: a long ragged edge gives one ring with > 150k points.
    const m = mask(w, h, (x, y) => y < 100 || (x % 2 === 0 && y < 199));
    expect(maskPolygons(m, w, h).length).toBeGreaterThan(0);
  });
});

