import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, featurePaths, toPlot, vectorToSvg, type Frame, type Geometry, type Ink, type Layers, type Position, type StepContext } from "@plotlab/engine";
import { cells } from "../src/cells/index.ts";
import { hatch } from "../src/fill/lattice.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.3 };
const ctx: StepContext = { paper: { widthMm: 40, heightMm: 40 }, target: { kind: "vector" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const P = defaultParams(cells.params);

/** A tone layer at 1 mm per pixel on `frame`, ink density from `f(x, y)` in pixel coordinates. */
function toneLayers(frame: Frame, f: (x: number, y: number) => number, ids = ["l"]): Layers {
  const w = frame.widthMm, h = frame.heightMm;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { kind: "layers", width: w, height: h, frame, layers: ids.map((id) => ({ id, name: id, values: { kind: "tone", data: Float32Array.from(data) } })) };
}
const run = async (input: Layers, params: Partial<typeof P> = {}) => (await applyStep(cells, input, { params: { ...P, ...params } }, ctx)) as Geometry;
const paths = (g: Geometry, i = 0) => g.layers[i]!.features.features.flatMap(featurePaths);
const corners = (p: Position[]) => p.slice(0, -1);
const centre = (p: Position[]): Position => {
  const c = corners(p);
  return [c.reduce((s, q) => s + q[0], 0) / c.length, c.reduce((s, q) => s + q[1], 0) / c.length];
};
const side = (p: Position[]) => Math.hypot(p[1]![0] - p[0]![0], p[1]![1] - p[0]![1]);
const onGrid = (v: number, c: number) => Math.abs(v / c - Math.round(v / c)) < 1e-9;
const full = { xMm: 0, yMm: 0, widthMm: 20, heightMm: 10 };

describe("cells", () => {
  it("lays one cell per grid square: the count follows the picture and cell size", async () => {
    expect(paths(await run(toneLayers(full, () => 1), { cellMm: 5 }))).toHaveLength(4 * 2);
    // 20 / 3 → 7 columns (the last one cut by the edge), 10 / 3 → 4 rows.
    expect(paths(await run(toneLayers(full, () => 1), { cellMm: 3 }))).toHaveLength(7 * 4);
  });

  it("outline: every path is a closed square with 4 corners on the grid", async () => {
    const ps = paths(await run(toneLayers(full, () => 0.8), { mode: "outline", cellMm: 5 }));
    for (const p of ps) {
      expect(p).toHaveLength(5);
      expect(p[4]).toEqual(p[0]);
      expect(new Set(corners(p).map((q) => q.join(","))).size).toBe(4);
      for (const [x, y] of corners(p)) {
        expect(onGrid(x, 5)).toBe(true);
        expect(onGrid(y, 5)).toBe(true);
      }
      expect(side(p)).toBeCloseTo(5, 9);
    }
  });

  it("scaled: squares grow with darkness and stay centred in their cell", async () => {
    // Darker to the right: one row of four 5 mm cells, darkness 0.25, 0.5, 0.75, 1.
    const g = await run(toneLayers({ xMm: 0, yMm: 0, widthMm: 20, heightMm: 5 }, (x) => (Math.floor(x / 5) + 1) / 4), { mode: "scaled", cellMm: 5, threshold: 0, minSize: 0, maxSize: 100 });
    const ps = paths(g).sort((a, b) => centre(a)[0] - centre(b)[0]);
    expect(ps).toHaveLength(4);
    const sides = ps.map(side);
    for (let i = 1; i < sides.length; i++) expect(sides[i]!).toBeGreaterThan(sides[i - 1]!);
    expect(sides[3]).toBeCloseTo(5, 6);
    expect(sides[0]).toBeCloseTo(5 * 0.25, 6);
    ps.forEach((p, i) => {
      expect(p[4]).toEqual(p[0]);
      expect(centre(p)[0]).toBeCloseTo(2.5 + 5 * i, 9);
      expect(centre(p)[1]).toBeCloseTo(2.5, 9);
    });
  });

  it("scaled: a cell cut by the picture's edge still gets a square, centred in what's left", async () => {
    // Frame from y = 4 to 9 with 5 mm cells: the top row is cut to y 4..5.
    const ps = paths(await run(toneLayers({ xMm: 0, yMm: 4, widthMm: 5, heightMm: 5 }, () => 1), { mode: "scaled", cellMm: 5, threshold: 0, minSize: 0, maxSize: 100 }));
    const sliver = ps.find((p) => centre(p)[1] < 5)!;
    const xs = corners(sliver).map((q) => q[0]), ys = corners(sliver).map((q) => q[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 9);
    expect(centre(sliver)).toEqual([2.5, 4.5]);
  });

  it("white cells emit nothing, in either mode", async () => {
    const input = toneLayers(full, (x) => (x < 10 ? 0 : 1));
    for (const mode of ["outline", "scaled"]) {
      const ps = paths(await run(input, { mode, cellMm: 5, threshold: 0, minSize: 20 }));
      expect(ps.length, mode).toBe(4);
      for (const p of ps) expect(centre(p)[0], mode).toBeGreaterThan(10);
    }
  });

  it("shares the paper origin with the fill lattice, and every layer gets the same cells", async () => {
    // A picture placed off the origin: cell edges still sit on multiples of the cell size,
    // exactly where Fill's horizontal hatch lines at the same spacing fall.
    const frame = { xMm: 3, yMm: 7, widthMm: 20, heightMm: 16 };
    const g = await run(toneLayers(frame, () => 1, ["a", "b"]), { cellMm: 5 });
    const edgesY = new Set(paths(g).flatMap((p) => corners(p).map((q) => q[1])).filter((y) => y > frame.yMm && y < frame.yMm + frame.heightMm));
    const rect: Position[] = [[frame.xMm, frame.yMm], [frame.xMm + frame.widthMm, frame.yMm], [frame.xMm + frame.widthMm, frame.yMm + frame.heightMm], [frame.xMm, frame.yMm + frame.heightMm]];
    const hatchY = new Set(hatch([rect], 5, 0).map((l) => Math.round(l[0]![1] * 1e9) / 1e9));
    expect([...edgesY].sort()).toEqual([...hatchY].sort());
    expect([...edgesY].sort()).toEqual([10, 15, 20]);
    // Cells cut by the picture's edge are clipped to it.
    for (const [x, y] of paths(g).flatMap(corners)) {
      expect(x).toBeGreaterThanOrEqual(frame.xMm);
      expect(x).toBeLessThanOrEqual(frame.xMm + frame.widthMm);
      expect(y).toBeGreaterThanOrEqual(frame.yMm);
    }
    expect(paths(g, 1)).toEqual(paths(g, 0));
  });

  it("reads darkness from levels: a darker band gives a bigger square", async () => {
    const data = Uint16Array.from({ length: 10 * 5 }, (_, i) => (i % 10 < 5 ? 1 : 2));
    const input: Layers = {
      kind: "layers", width: 10, height: 5, frame: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 5 },
      layers: [{ id: "l", name: "l", values: { kind: "categories", data, count: 2, bands: [{ lo: 0, hi: 0.4 }, { lo: 0.4, hi: 1 }] } }],
    };
    const ps = paths(await run(input, { mode: "scaled", cellMm: 5, threshold: 0, minSize: 0, maxSize: 100 })).sort((a, b) => centre(a)[0] - centre(b)[0]);
    expect(ps.map(side)[0]).toBeCloseTo(5 * 0.2, 6);
    expect(ps.map(side)[1]).toBeCloseTo(5 * 0.7, 6);
  });

  it("gap shrinks the squares and rotate turns them about the cell centre", async () => {
    const one = toneLayers({ xMm: 0, yMm: 0, widthMm: 5, heightMm: 5 }, () => 1);
    const [g] = paths(await run(one, { cellMm: 5, gap: 1 }));
    expect(side(g!)).toBeCloseTo(4, 9);
    const [r] = paths(await run(one, { cellMm: 5, rotate: 45 }));
    expect(centre(r!)[0]).toBeCloseTo(2.5, 9);
    expect(centre(r!)[1]).toBeCloseTo(2.5, 9);
    expect(side(r!)).toBeCloseTo(5, 9);
    expect(r![0]![0]).toBeCloseTo(2.5, 9); // a corner points straight up
  });

  it("exports as crisp vector squares: one closed path each, no embedded image", async () => {
    const g = await run(toneLayers(full, () => 1), { cellMm: 5 });
    const svg = vectorToSvg({ plot: toPlot(g, ctx) });
    expect(svg).not.toContain("<image");
    const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]!);
    expect(ds).toHaveLength(8);
    expect(ds[0]).toBe("M0 0 L5 0 L5 5 L0 5 L0 0");
  });
});
