import { describe, expect, it } from "vitest";
import { applyStep, checkChain, defaultParams, type Image, type Ink, type StepContext } from "@plotlab/engine";
import { createRegistry, presetSteps, reaction } from "../src/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 100, heightMm: 100 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };

/** A grey image of w × h pixels covering w·mmPerPx × h·mmPerPx on the paper. */
function gray(w: number, h: number, mmPerPx: number, f: (x: number, y: number) => number): Image {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { kind: "image", width: w, height: h, channels: 1, data, frame: { xMm: 5, yMm: 7, widthMm: w * mmPerPx, heightMm: h * mmPerPx } };
}

const run = async (img: Image, params: Record<string, unknown> = {}, c: StepContext = ctx) =>
  (await applyStep(reaction, img, { params: { ...defaultParams(reaction.params), ...params } }, c)) as Image;

const stats = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0, s2 = 0;
  for (let i = from; i < to; i++) (s += a[i]!), (s2 += a[i]! * a[i]!);
  const n = to - from, mean = s / n;
  return { mean, variance: s2 / n - mean * mean };
};

// Small and quick: 40 × 40 mm at 0.5 mm per pixel, coarse features, few iterations.
const quick = { scale: 4, iterations: 1500 };

describe("reaction (Gray–Scott)", () => {
  it("is experimental, on-demand and seeded", () => {
    expect(reaction.experimental).toBe(true);
    expect(reaction.cost).toBe("on-demand");
    expect(reaction.input).toBe("image");
    expect(reaction.output).toBe("image");
    expect(reaction.params.seed.seed).toBe(true);
  });

  it("keeps the dimensions and frame, makes one grey channel in 0..1", async () => {
    const img = gray(80, 60, 0.5, (x) => x / 79);
    const out = await run(img, quick);
    expect(out.kind).toBe("image");
    expect([out.width, out.height, out.channels]).toEqual([80, 60, 1]);
    expect(out.frame).toEqual(img.frame);
    expect(out.data.length).toBe(80 * 60);
    for (const v of out.data) expect(v >= 0 && v <= 1 && !Number.isNaN(v)).toBe(true);
  });

  it("the same seed gives identical output; another seed gives a different one", async () => {
    const img = gray(60, 60, 0.5, () => 0.5);
    const a = await run(img, { ...quick, seed: 3 });
    const b = await run(img, { ...quick, seed: 3 });
    const c = await run(img, { ...quick, seed: 4 });
    expect([...a.data]).toEqual([...b.data]);
    expect([...a.data]).not.toEqual([...c.data]);
  });

  it("with uniform tone a pattern forms and holds instead of fading to flat", async () => {
    const img = gray(80, 80, 0.5, () => 0.5);
    const early = stats((await run(img, { ...quick, iterations: 2000 })).data);
    const late = stats((await run(img, { ...quick, iterations: 4000 })).data);
    expect(early.variance).toBeGreaterThan(0.02);
    expect(late.variance).toBeGreaterThan(0.02);
    expect(late.variance).toBeGreaterThan(early.variance * 0.5);
  });

  it("tone sets the pattern: a light half and a dark half come out measurably different", async () => {
    const w = 80, h = 80;
    const img = gray(w, h, 0.5, (x) => (x < w / 2 ? 0.95 : 0.05));
    const out = await run(img, { ...quick, iterations: 3000 });
    // Mean grey of each half, keeping clear of the seam.
    let light = 0, dark = 0, nl = 0, nd = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = out.data[y * w + x]!;
        if (x < w / 2 - 8) (light += v), nl++;
        else if (x >= w / 2 + 8) (dark += v), nd++;
      }
    // Light source → sparse ink (light output); dark source → dense ink.
    expect(light / nl - dark / nd).toBeGreaterThan(0.1);
  });

  it("feature size is in mm, so a proxy at lower resolution shows the same pattern scale", async () => {
    const fine = await run(gray(80, 80, 0.5, () => 0.5), quick);
    const coarse = await run(gray(40, 40, 1, () => 0.5), quick);
    // Sample the fine result at the coarse pixel centres: close to the coarse result.
    let diff = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) diff += Math.abs(coarse.data[y * 40 + x]! - (fine.data[(2 * y) * 80 + 2 * x]! + fine.data[(2 * y + 1) * 80 + 2 * x + 1]!) / 2);
    expect(diff / 1600).toBeLessThan(0.15);
  });

  it("reports progress up to 1", async () => {
    const seen: number[] = [];
    await run(gray(40, 40, 0.5, () => 0.5), { ...quick, iterations: 500 }, { ...ctx, progress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it("the Turing preset chains cleanly from an image to a plot", () => {
    const steps = presetSteps("turing");
    expect(steps[0]!.step).toBe("reaction");
    expect(checkChain("image", steps, createRegistry())).toEqual([]);
    expect(createRegistry().get(steps.at(-1)!.step)!.output).toBe("plot");
  });
});
