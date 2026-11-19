import { describe, expect, it } from "vitest";
import { applyStep, featurePaths, loadRecipe, type Frame, type GeometryLayer, type Layers, type StepContext } from "@plotlab/engine";
import { centerline, createRegistry } from "../src/index.ts";
import { pruneSpurs, thin, traceSkeleton } from "../src/centerline/index.ts";

const ctx = { paper: { widthMm: 100, heightMm: 100 }, target: { kind: "plotter" }, inks: [], inkFor: () => undefined, passOrder: "light-to-dark" } as unknown as StepContext;
/** 1 mm per pixel, so spur lengths in mm are pixels. */
const frameFor = (w: number, h: number): Frame => ({ xMm: 0, yMm: 0, widthMm: w, heightMm: h });

function mask(w: number, h: number, f: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0;
  return m;
}
const on = (m: Uint8Array, w: number, x: number, y: number) => m[y * w + x] === 1;
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

async function trace(w: number, h: number, f: (x: number, y: number) => boolean, params: Record<string, unknown>) {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y) ? 1 : 0;
  const layers: Layers = { kind: "layers", width: w, height: h, frame: frameFor(w, h), layers: [{ id: "l", name: "l", values: { kind: "tone", data } }] };
  const out = (await applyStep(centerline, layers as never, { params }, ctx)) as unknown as { layers: GeometryLayer[] };
  return out.layers[0]!.features.features.map((f) => featurePaths(f)[0]!);
}

describe("pruneSpurs on a one-pixel skeleton", () => {
  const w = 60, h = 30;
  it("removes a short stub off a T and keeps the bar whole", () => {
    // Bar along y = 10 from x = 5..54, stub down from x = 30 for 4 px.
    const m = mask(w, h, (x, y) => (y === 10 && x >= 5 && x <= 54) || (x === 30 && y > 10 && y <= 14));
    const p = pruneSpurs(m, w, h, 6);
    for (let y = 11; y <= 14; y++) expect(on(p, w, 30, y), `stub pixel y=${y}`).toBe(false);
    for (let x = 5; x <= 54; x++) expect(on(p, w, x, 10), `bar pixel x=${x}`).toBe(true);
  });
  it("removes a short arm off a Y and keeps the two long arms", () => {
    // Long arms: diagonal up-left and up-right from (30, 15), 12 px each; short stem down 3 px.
    const m = mask(w, h, (x, y) => {
      const d = 30 - x, e = x - 30, up = 15 - y;
      return (up >= 0 && up <= 12 && (d === up || e === up)) || (x === 30 && y > 15 && y <= 18);
    });
    const p = pruneSpurs(m, w, h, 5);
    for (let y = 16; y <= 18; y++) expect(on(p, w, 30, y)).toBe(false);
    expect(on(p, w, 18, 3)).toBe(true);
    expect(on(p, w, 42, 3)).toBe(true);
    expect(count(p)).toBe(25);
  });
  it("leaves a lone straight line alone however long the spur setting", () => {
    const m = mask(w, h, (x, y) => y === 5 && x >= 10 && x <= 15);
    expect([...pruneSpurs(m, w, h, 50)]).toEqual([...m]);
  });
  it("leaves a closed loop alone and strips a spur off it", () => {
    const ring = (x: number, y: number) => x >= 10 && x <= 30 && y >= 5 && y <= 25 && (x === 10 || x === 30 || y === 5 || y === 25);
    const m = mask(w, h, (x, y) => ring(x, y) || (y === 15 && x > 30 && x <= 33));
    const p = pruneSpurs(m, w, h, 5);
    expect([...p]).toEqual([...mask(w, h, ring)]);
  });
  it("spur length 0 changes nothing", () => {
    const m = mask(w, h, (x, y) => (y === 10 && x >= 5 && x <= 54) || (x === 30 && y > 10 && y <= 14));
    expect([...pruneSpurs(m, w, h, 0)]).toEqual([...m]);
  });
});

describe("pruneSpurs on thick crossings", () => {
  // Thinning leaves the middle of an X or + as a clump of junction pixels; it is one junction.
  const w = 40, h = 40, c = 20;
  const shapes: Record<string, (x: number, y: number) => boolean> = {};
  for (const [arm, half] of [[8, 2], [6, 1.5]] as const) {
    shapes[`X ${arm}/${half}`] = (x, y) => Math.abs(x - c) <= arm && (Math.abs(x - c - (y - c)) <= half || Math.abs(x - c + (y - c)) <= half);
    shapes[`plus ${arm}/${half}`] = (x, y) => (Math.abs(y - c) <= half && Math.abs(x - c) <= arm) || (Math.abs(x - c) <= half && Math.abs(y - c) <= arm);
  }
  /** Skeleton pixels farthest out along each arm direction. */
  const reach = (m: Uint8Array) => {
    const r = { E: 0, W: 0, N: 0, S: 0, NE: 0, NW: 0, SE: 0, SW: 0 };
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const dx = (i % w) - c, dy = Math.floor(i / w) - c;
      r.E = Math.max(r.E, dx); r.W = Math.max(r.W, -dx); r.S = Math.max(r.S, dy); r.N = Math.max(r.N, -dy);
      r.SE = Math.max(r.SE, Math.min(dx, dy)); r.NW = Math.max(r.NW, Math.min(-dx, -dy));
      r.NE = Math.max(r.NE, Math.min(dx, -dy)); r.SW = Math.max(r.SW, Math.min(-dx, dy));
    }
    return r;
  };
  for (const [name, f] of Object.entries(shapes)) {
    it(`a small thick ${name} keeps all four arms even when the spur length beats them`, () => {
      const skel = thin(mask(w, h, f), w, h);
      for (const L of [4, 6, 8, 10, 12, 14, 16, 30]) {
        const p = pruneSpurs(skel, w, h, L);
        const r = reach(p), before = reach(skel);
        const dirs = name.startsWith("X") ? (["NE", "NW", "SE", "SW"] as const) : (["N", "S", "E", "W"] as const);
        for (const d of dirs) expect(r[d], `${name} L=${L} arm ${d}`).toBeGreaterThanOrEqual(before[d] - 1);
      }
    });
    it(`a small thick ${name} still traces to the same strokes end to end`, async () => {
      const at = async (spurLength: number) => {
        const data = new Float32Array(w * h);
        const m = mask(w, h, f);
        for (let i = 0; i < m.length; i++) data[i] = m[i]!;
        const layers: Layers = { kind: "layers", width: w, height: h, frame: { xMm: 0, yMm: 0, widthMm: w * 0.25, heightMm: h * 0.25 }, layers: [{ id: "l", name: "l", values: { kind: "tone", data } }] };
        const out = (await applyStep(centerline, layers as never, { params: { minLength: 1, smoothing: 0, spurLength } }, ctx)) as unknown as { layers: GeometryLayer[] };
        return out.layers[0]!.features.features.length;
      };
      const base = await at(0);
      expect(base).toBeGreaterThanOrEqual(4);
      expect(await at(2)).toBe(base);
      expect(await at(3)).toBe(base);
    });
  }
});

describe("centerline spur length", () => {
  // A thick bar with a small bump on top: thinning leaves a short spur to the bump.
  const bar = (x: number, y: number) => (x >= 4 && x < 56 && y >= 10 && y < 17) || (x >= 28 && x < 32 && y >= 6 && y < 10);
  it("drops the bump's spur but keeps the bar's stroke about as long", async () => {
    const raw = await trace(60, 24, bar, { minLength: 0, smoothing: 0, spurLength: 0 });
    expect(raw.length).toBeGreaterThan(1); // the spur is there without pruning
    const pruned = await trace(60, 24, bar, { minLength: 0, smoothing: 0, spurLength: 6 });
    expect(pruned).toHaveLength(1);
    const xs = pruned[0]!.map((p) => p[0]);
    const span = (ps: number[][][]) => { const all = ps.flat().map((p) => p[0]!); return Math.max(...all) - Math.min(...all); };
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(span(raw) - 2 * 4); // ends lose at most the end forks
    for (const [, y] of pruned[0]!) expect(Math.abs(y - 13)).toBeLessThanOrEqual(1.5);
  });
  it("a ring stays one closed loop", async () => {
    const ring = (x: number, y: number) => { const r = Math.hypot(x - 20, y - 20); return r > 10 && r < 15; };
    const paths = await trace(40, 40, ring, { minLength: 4, smoothing: 0, spurLength: 5 });
    expect(paths).toHaveLength(1);
    const c = paths[0]!;
    expect(Math.hypot(c[0]![0] - c[c.length - 1]![0], c[0]![1] - c[c.length - 1]![1])).toBeLessThan(1.5);
  });
  it("spur length 0 gives the unpruned trace exactly", async () => {
    const blob = (x: number, y: number) => bar(x, y) || Math.hypot(x - 45, y - 5) < 4;
    const got = await trace(60, 24, blob, { minLength: 0, smoothing: 0, spurLength: 0 });
    const m = mask(60, 24, blob);
    const want = traceSkeleton(thin(m, 60, 24), 60, 24).map((ids) => ids.map((i) => [(i % 60) + 0.5, Math.floor(i / 60) + 0.5]));
    expect(got).toEqual(want);
  });
});

describe("centerline migrate", () => {
  const registry = createRegistry();
  const recipe = (version: number) => ({ schemaVersion: 2, input: "layers", paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 }], steps: [{ step: "centerline", version, params: { minLength: 4, smoothing: 1 } }] });
  it("v2 recipes get spur length 0 and a note", () => {
    const { recipe: r, warnings } = loadRecipe(recipe(2), registry);
    expect(r.steps[0]!.params.spurLength).toBe(0);
    expect(r.steps[0]!.version).toBe(centerline.version);
    expect(warnings.some((x) => /spur/i.test(x.message))).toBe(true);
  });
  it("v1 recipes also get spur length 0", () => {
    const { recipe: r } = loadRecipe(recipe(1), registry);
    expect(r.steps[0]!.params.spurLength).toBe(0);
  });
  it("leaves per-layer overrides holding only what the user set", () => {
    const r = recipe(2) as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    r.steps[0]!.layerParams = { l1: { minLength: 2 }, l2: {} };
    const { recipe: out } = loadRecipe(r, registry);
    expect(out.steps[0]!.params.spurLength).toBe(0);
    expect(out.steps[0]!.layerParams).toEqual({ l1: { minLength: 2 }, l2: {} });
  });
  it("new recipes use a non-zero default", () => {
    expect(centerline.params.spurLength.default).toBeGreaterThan(0);
  });
});
