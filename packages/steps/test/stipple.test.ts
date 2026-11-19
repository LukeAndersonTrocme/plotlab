import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, featurePaths, type Frame, type Geometry, type Ink, type Layers, type Position, type StepContext, type StepWarning } from "@plotlab/engine";
import { stipple } from "../src/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.3 };
const ctx: StepContext = { paper: { widthMm: 200, heightMm: 200 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };

function toneLayers(w: number, h: number, frame: Frame, f: (x: number, y: number) => number): Layers {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { kind: "layers", width: w, height: h, frame, layers: [{ id: "tone", name: "Ink density", values: { kind: "tone", data } }] };
}
const P = defaultParams(stipple.params);
const run = async (layers: Layers, params: Partial<typeof P> = {}) =>
  ((await applyStep(stipple, layers, { params: { ...P, ...params } }, ctx)) as Geometry).layers[0]!.features.features.flatMap(featurePaths);
/** The centre of each dot (taps are [p, p]; circles are rings around the centre). */
const centre = (p: Position[]): Position => {
  const pts = p.length > 2 ? p.slice(0, -1) : p.slice(0, 1);
  return [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
};

const square: Frame = { xMm: 0, yMm: 0, widthMm: 60, heightMm: 60 };
const gradient = toneLayers(60, 60, square, (x) => x / 59);

describe("stipple", () => {
  it("is experimental, seeded, and acts per tone layer", () => {
    expect(stipple.experimental).toBe(true);
    expect(stipple.input).toBe("layers");
    expect(stipple.output).toBe("geometry");
    expect(stipple.params.seed.seed).toBe(true);
    expect(stipple.accepts).toEqual(["tone"]);
  });

  it("the same seed gives the same dots; a different seed gives different dots", async () => {
    const a = await run(gradient, { seed: 3 });
    const b = await run(gradient, { seed: 3 });
    const c = await run(gradient, { seed: 4 });
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("puts more dots where the tone is darker", async () => {
    const dots = (await run(gradient, { spacing: 1.5 })).map(centre);
    const light = dots.filter(([x]) => x < 20).length;
    const dark = dots.filter(([x]) => x >= 40).length;
    // Mean tone of the thirds is about 1/6 vs 5/6, so about five times as many dots.
    expect(dark).toBeGreaterThan(light * 3);
    expect(light).toBeGreaterThan(0);
  });

  it("relaxation keeps dot density proportional to tone (not flattened toward its square root)", async () => {
    // Six stripes, 10 mm wide, alternating 0.2 and 0.8 tone: equal areas, so 4× the dots in the dark ones.
    const stripes = toneLayers(120, 120, square, (x) => (Math.floor(x / 20) % 2 ? 0.8 : 0.2));
    const dots = (await run(stripes, { spacing: 1.2, iterations: 30 })).map(centre);
    const dark = dots.filter(([x]) => Math.floor(x / 10) % 2).length;
    const ratio = dark / (dots.length - dark);
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("averages tone over each grid cell, so fine lines aren't lost or aliased", async () => {
    // 100 mm at 2000 px: 1-px black lines every 8 or 9 px, finer than the density grid.
    for (const every of [8, 9]) {
      const lines = toneLayers(2000, 2000, { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, (x) => (x % every === 0 ? 1 : 0));
      const dots = (await run(lines, { iterations: 0 })).map(centre);
      const expected = (100 * 100) / every / (P.spacing * P.spacing);
      expect(dots.length / expected, `every ${every}`).toBeGreaterThan(0.95);
      expect(dots.length / expected, `every ${every}`).toBeLessThan(1.05);
      // No moiré: every 10 mm column gets close to its share.
      for (let c = 0; c < 10; c++) {
        const k = dots.filter(([x]) => x >= c * 10 && x < c * 10 + 10).length;
        expect(k / (dots.length / 10), `every ${every}, column ${c}`).toBeGreaterThan(0.75);
        expect(k / (dots.length / 10), `every ${every}, column ${c}`).toBeLessThan(1.25);
      }
    }
  });

  it("gives each layer its own scatter, so inks interleave instead of overprinting", async () => {
    const one = toneLayers(30, 30, square, () => 0.7);
    const two: Layers = { ...one, layers: [one.layers[0]!, { ...one.layers[0]!, id: "tone2", name: "Second" }] };
    const geo = (await applyStep(stipple, two, { params: P }, ctx)) as Geometry;
    const [a, b] = geo.layers.map((l) => l.features.features.flatMap(featurePaths).map((p) => JSON.stringify(p[0])));
    expect(a!.length).toBeGreaterThan(50);
    // Relaxed dots land on centroids of grid cells, so the odd one can coincide by chance;
    // with one shared scatter every dot would.
    const shared = b!.filter((p) => new Set(a).has(p)).length;
    expect(shared / b!.length).toBeLessThan(0.02);
    // Still deterministic per layer: the first layer matches a single-layer run.
    expect(a).toEqual((await run(one)).map((p) => JSON.stringify(p[0])));
  });

  it("reports progress once across all layers, ending at 1, even with no relaxation", async () => {
    const one = toneLayers(30, 30, square, () => 0.7);
    const two: Layers = { ...one, layers: [one.layers[0]!, { ...one.layers[0]!, id: "tone2", name: "Second" }] };
    for (const iterations of [0, 5]) {
      const seen: number[] = [];
      await applyStep(stipple, two, { params: { ...P, iterations } }, { ...ctx, progress: (f) => seen.push(f) });
      expect(seen.length, `iterations ${iterations}`).toBeGreaterThan(0);
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(seen[seen.length - 1]).toBe(1);
      expect(seen.some((f) => f <= 0.5)).toBe(true);
    }
  });

  it("makes about one dot per spacing² of full ink", async () => {
    const full = toneLayers(40, 40, { xMm: 0, yMm: 0, widthMm: 40, heightMm: 40 }, () => 1);
    const n = (await run(full, { spacing: 2 })).length;
    expect(n).toBeGreaterThan(380);
    expect(n).toBeLessThan(420);
  });

  it("leaves bare paper without dots", async () => {
    expect(await run(toneLayers(20, 20, square, () => 0))).toEqual([]);
  });

  it("keeps every dot inside the layer's frame on the paper", async () => {
    const frame: Frame = { xMm: 30, yMm: 50, widthMm: 40, heightMm: 25 };
    const layers = toneLayers(80, 50, frame, (x, y) => ((x + y) % 7) / 6);
    for (const shape of ["tap", "circle"] as const) {
      const paths = await run(layers, { shape, dotSize: 1, spacing: 1 });
      expect(paths.length).toBeGreaterThan(50);
      for (const p of paths) for (const [x, y] of p) {
        expect(x).toBeGreaterThanOrEqual(frame.xMm);
        expect(x).toBeLessThanOrEqual(frame.xMm + frame.widthMm);
        expect(y).toBeGreaterThanOrEqual(frame.yMm);
        expect(y).toBeLessThanOrEqual(frame.yMm + frame.heightMm);
      }
    }
  });

  it("draws a tap as one pen touch and a circle as a small closed ring", async () => {
    const full = toneLayers(20, 20, { xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 }, () => 1);
    for (const p of await run(full, { shape: "tap" })) expect(p).toEqual([p[0], p[0]]);
    for (const p of await run(full, { shape: "circle", dotSize: 0.8 })) {
      expect(p[0]).toEqual(p[p.length - 1]);
      const [cx, cy] = centre(p);
      for (const [x, y] of p) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(0.4, 5);
    }
  });

  it("relaxation spreads the dots out more evenly", async () => {
    const flat = toneLayers(50, 50, { xMm: 0, yMm: 0, widthMm: 50, heightMm: 50 }, () => 0.6);
    // Coefficient of variation of nearest-neighbour distances: lower = more even.
    const evenness = (pts: Position[]) => {
      const nn = pts.map((p, i) => Math.min(...pts.map((q, j) => (i === j ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1])))));
      const m = nn.reduce((s, d) => s + d, 0) / nn.length;
      return Math.sqrt(nn.reduce((s, d) => s + (d - m) ** 2, 0) / nn.length) / m;
    };
    const raw = evenness((await run(flat, { iterations: 0, spacing: 2 })).map(centre));
    const relaxed = evenness((await run(flat, { iterations: 10, spacing: 2 })).map(centre));
    expect(relaxed).toBeLessThan(raw * 0.6);
  });

  it("refuses category layers with a plain reason", async () => {
    const layers: Layers = { ...gradient, layers: [{ id: "b", name: "Bands", values: { kind: "categories", data: new Uint16Array(3600), count: 3 } }] };
    await expect(async () => applyStep(stipple, layers, { params: P }, ctx)).rejects.toThrow(/holds categories/);
  });

  it("warns when it stops at the dot cap, and says what to change", async () => {
    // Full tone over 100 × 100 mm at 0.3 mm spacing asks for about 111,000 dots.
    const big = toneLayers(50, 50, { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, () => 1);
    const warnings: StepWarning[] = [];
    const out = (await applyStep(stipple, big, { params: { ...P, spacing: 0.3, iterations: 0 } }, ctx, warnings)) as Geometry;
    expect(out.layers[0]!.features.features).toHaveLength(60000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.layer).toBe("tone");
    expect(warnings[0]!.message).toMatch(/60,000 dots/);
    expect(warnings[0]!.message).toMatch(/111,111/);
    expect(warnings[0]!.message).toMatch(/Darkest spacing/);
  });

  it("does not warn at normal settings", async () => {
    const warnings: StepWarning[] = [];
    await applyStep(stipple, gradient, { params: P }, ctx, warnings);
    expect(warnings).toEqual([]);
  });
});
