import { describe, expect, it } from "vitest";
import type { Position } from "@plotlab/engine";
import { dots, hatch } from "../src/fill/lattice.ts";
import { pointInRing } from "../src/bands/trace.ts";

const rect = (x: number, y: number, w: number, h: number): Position[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const mid = (l: Position[]): Position => [(l[0]![0] + l[1]![0]) / 2, (l[0]![1] + l[1]![1]) / 2];
const len = (l: Position[]) => Math.hypot(l[1]![0] - l[0]![0], l[1]![1] - l[0]![1]);

describe("hatch", () => {
  it("fills a square with parallel lines at the spacing", () => {
    const ls = hatch([rect(0.5, 0.5, 10, 10)], 1, 0);
    expect(ls).toHaveLength(10);
    for (const l of ls) expect(len(l)).toBeCloseTo(10, 6);
  });
  it("leaves holes empty and stays inside concave shapes", () => {
    const outer = rect(0, 0, 20, 20), hole = rect(6, 6, 8, 8).reverse();
    for (const l of hatch([outer, hole], 0.7, 30)) {
      const m = mid(l);
      expect(pointInRing(m, outer)).toBe(true);
      expect(pointInRing(m, hole)).toBe(false);
    }
    const L: Position[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    for (const l of hatch([L], 0.5, 45)) expect(pointInRing(mid(l), L)).toBe(true);
  });
  it("shares one lattice across the page: neighbouring shapes line up", () => {
    const ya = hatch([rect(0, 0.3, 5, 10)], 1, 0).map((l) => l[0]![1]).sort();
    const yb = hatch([rect(5, 0.3, 5, 10)], 1, 0).map((l) => l[0]![1]).sort();
    expect(ya).toEqual(yb);
  });
  it("clamps tiny spacing so it always finishes", () => {
    expect(hatch([rect(0, 0, 1, 1)], 0, 0).length).toBeLessThanOrEqual(11);
  });
});

describe("dots", () => {
  it("puts lattice points inside the shape", () => {
    const ds = dots([rect(0.5, 0.5, 10, 10)], 2, 0, 0.1);
    expect(ds).toHaveLength(25);
    for (const d of ds) expect(d[0]).toEqual(d[1]);
  });
  it("bigger dots are small closed circles", () => {
    const [d] = dots([rect(0.5, 0.5, 4, 4)], 2, 0, 0.5);
    expect(d!.length).toBe(9);
    expect(d![0]).toEqual(d![8]);
  });
});
