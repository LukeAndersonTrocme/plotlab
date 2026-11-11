import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultParams, type Frame, type Image, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { allSteps, centerline, order, threshold } from "../src/index.ts";
import { otsuLevel } from "../src/threshold/index.ts";
import { orderPaths } from "../src/order/index.ts";
import { generate } from "../scripts/gen-help.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = {
  paper: { widthMm: 100, heightMm: 100 },
  target: { kind: "plotter" },
  inks: [ink],
  inkFor: () => ink,
  passOrder: "light-to-dark",
};
/** 1 mm per pixel, starting at the paper origin, so pixel and mm coordinates match. */
const frameFor = (w: number, h: number): Frame => ({ xMm: 0, yMm: 0, widthMm: w, heightMm: h });

function gray(w: number, h: number, f: (x: number, y: number) => number): Image {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { kind: "image", width: w, height: h, channels: 1, data, frame: frameFor(w, h) };
}

function maskLayers(w: number, h: number, f: (x: number, y: number) => boolean): Layers {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y) ? 1 : 0;
  return { kind: "layers", width: w, height: h, frame: frameFor(w, h), layers: [{ id: "l", name: "l", values: { kind: "tone", data } }] };
}

describe("step contract", () => {
  it("every step has help, a summary and in-range defaults", () => {
    for (const s of allSteps) {
      expect(s.help.length, s.id).toBeGreaterThan(20);
      expect(s.summary.length, s.id).toBeGreaterThan(10);
      for (const [k, d] of Object.entries(s.params)) {
        if (d.type === "number") expect(d.default >= d.min && d.default <= d.max, `${s.id}.${k}`).toBe(true);
      }
    }
  });
  it("help.generated.ts is in sync with help.md files", () => {
    const current = readFileSync(new URL("../src/help.generated.ts", import.meta.url), "utf8");
    expect(current, "run pnpm --filter @plotlab/steps gen:help").toBe(generate());
  });
});

describe("threshold", () => {
  it("dark pixels become ink; invert flips", async () => {
    const img = gray(4, 1, (x) => x / 3);
    const out = (await threshold.run(img, { mode: "fixed", level: 50, invert: false }, ctx)) as Layers;
    expect(out.layers[0]!.values.kind).toBe("tone");
    expect([...out.layers[0]!.values.data]).toEqual([1, 1, 0, 0]);
    expect(out.frame).toEqual(img.frame);
    const inv = (await threshold.run(img, { mode: "fixed", level: 50, invert: true }, ctx)) as Layers;
    expect([...inv.layers[0]!.values.data]).toEqual([0, 0, 1, 1]);
  });
  it("otsu splits a bimodal image between the modes", () => {
    const lum = new Float32Array([...Array(50).fill(0.2), ...Array(50).fill(0.8)]);
    const t = otsuLevel(lum);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThanOrEqual(0.8);
  });
});

describe("centerline", () => {
  it("a thick horizontal bar becomes one roughly straight stroke", async () => {
    const geo = await centerline.run(maskLayers(40, 11, (x, y) => x >= 2 && x < 38 && y >= 3 && y < 8), defaultParams(centerline.params), ctx);
    const feats = geo.layers[0]!.features.features;
    expect(feats).toHaveLength(1);
    const ys = feats[0]!.geometry.coordinates.map((c) => c[1]);
    for (const y of ys) expect(Math.abs(y - 5.5)).toBeLessThanOrEqual(1.5);
  });
  it("a ring becomes a closed loop", async () => {
    const geo = await centerline.run(
      maskLayers(40, 40, (x, y) => { const r = Math.hypot(x - 20, y - 20); return r > 10 && r < 15; }),
      { minLength: 4, smoothing: 0 },
      ctx,
    );
    const feats = geo.layers[0]!.features.features;
    expect(feats).toHaveLength(1);
    const c = feats[0]!.geometry.coordinates;
    expect(Math.hypot(c[0]![0] - c[c.length - 1]![0], c[0]![1] - c[c.length - 1]![1])).toBeLessThan(1.5);
  });
});

describe("centerline on paper", () => {
  it("places strokes in paper mm through the frame", async () => {
    const layers = maskLayers(40, 11, (x, y) => x >= 2 && x < 38 && y >= 3 && y < 8);
    layers.frame = { xMm: 100, yMm: 50, widthMm: 20, heightMm: 5.5 }; // 0.5 mm per pixel
    const geo = await centerline.run(layers, { minLength: 2, smoothing: 0.2 }, ctx);
    for (const [x, y] of geo.layers[0]!.features.features[0]!.geometry.coordinates) {
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(120);
      expect(Math.abs(y - 52.75)).toBeLessThanOrEqual(0.75);
    }
  });
  it("refuses category layers with a plain reason", async () => {
    const layers: Layers = { ...maskLayers(4, 4, () => true) };
    layers.layers = [{ id: "b", name: "Bands", values: { kind: "categories", data: new Uint16Array(16), count: 3 } }];
    await expect(async () => centerline.run(layers, defaultParams(centerline.params), ctx)).rejects.toThrow(/holds categories/);
  });
});

describe("order", () => {
  it("returns an ordered plot with the layer's ink", async () => {
    const geo = await centerline.run(maskLayers(40, 11, (x, y) => x >= 2 && x < 38 && y >= 3 && y < 8), defaultParams(centerline.params), ctx);
    const out = await order.run(geo, { method: "nearest", allowReverse: true }, ctx);
    expect(out.ordered).toBe(true);
    expect(out.layers[0]!.ink).toEqual(ink);
    expect(out.layers[0]!.paths.length).toBe(geo.layers[0]!.features.features.length);
  });
  it("nearest-first ordering reverses strokes when closer", () => {
    const out = orderPaths([[[50, 0], [100, 0]], [[10, 0], [1, 0]]], true);
    expect(out[0]).toEqual([[1, 0], [10, 0]]);
  });
});
