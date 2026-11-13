import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, type Image, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { levels, tone } from "../src/index.ts";
import { blurTone, cutPoints } from "../src/levels/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 10, heightMm: 10 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const frame = { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 };

describe("tone (ink density)", () => {
  it("is 1 − luminance, with invert and contrast", async () => {
    const img: Image = { kind: "image", width: 3, height: 1, channels: 1, data: new Float32Array([0, 0.5, 1]), frame };
    const out = (await applyStep(tone, img, { params: defaultParams(tone.params) }, ctx)) as Layers;
    const v = out.layers[0]!.values;
    expect(v.kind).toBe("tone");
    expect([...v.data]).toEqual([1, 0.5, 0]);
    const inv = (await applyStep(tone, img, { params: { invert: true, contrast: 1 } }, ctx)) as Layers;
    expect([...inv.layers[0]!.values.data]).toEqual([0, 0.5, 1]);
    const hard = (await applyStep(tone, img, { params: { invert: false, contrast: 3 } }, ctx)) as Layers;
    expect([...hard.layers[0]!.values.data]).toEqual([1, 0.5, 0]);
  });
});

describe("cutPoints", () => {
  const uniform = Float32Array.from({ length: 1001 }, (_, i) => i / 1000);
  it("equal-interval", () => expect(cutPoints(uniform, 4, "equal", [])).toEqual([0.25, 0.5, 0.75]));
  it("quantile on uniform data ≈ equal-interval", () => {
    const q = cutPoints(uniform, 4, "quantile", []);
    expect(q).toHaveLength(3);
    q.forEach((c, i) => expect(c).toBeCloseTo((i + 1) / 4, 2));
  });
  it("quantile on mostly-flat data: the flat value is one band, the rest still split, no empty bands", () => {
    const flat = Float32Array.from({ length: 1000 }, (_, i) => (i < 900 ? 0 : (i - 900) / 100));
    const q = cutPoints(flat, 5, "quantile", []);
    expect(q).toHaveLength(4);
    expect(q[0]!).toBeLessThan(0.01);
    expect(q[1]!).toBeGreaterThan(0.1);
    expect(new Set(q).size).toBe(q.length);
    for (const c of q) expect(c > 0 && c < 1 && !Number.isNaN(c)).toBe(true);
  });
  it("custom cuts are sorted, in 0..1", () => expect(cutPoints(uniform, 0, "custom", [70, 20])).toEqual([0.2, 0.7]));
});

describe("blurTone", () => {
  it("keeps the mean", () => {
    const d = Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 1 : 0));
    const b = blurTone(d, 10, 10, 2);
    const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean(b)).toBeCloseTo(mean(d), 2);
  });
});

describe("levels", () => {
  it("labels 1 = lightest … N = darkest, with tone ranges covering 0..1", async () => {
    const data = Float32Array.from({ length: 100 }, (_, i) => i / 99);
    const input: Layers = { kind: "layers", width: 10, height: 10, frame, layers: [{ id: "tone", name: "Ink density", values: { kind: "tone", data } }] };
    const out = (await applyStep(levels, input, { params: { count: 4, method: "equal", cuts: "", smoothing: 0 } }, ctx)) as Layers;
    const v = out.layers[0]!.values;
    if (v.kind !== "categories") throw new Error("expected categories");
    expect(v.count).toBe(4);
    expect(v.data[0]).toBe(1);
    expect(v.data[99]).toBe(4);
    expect(v.bands?.[0]?.lo).toBe(0);
    expect(v.bands?.[3]?.hi).toBe(1);
    expect(v.bands?.map((b) => b.lo)).toEqual([0, 0.25, 0.5, 0.75]);
  });
});
