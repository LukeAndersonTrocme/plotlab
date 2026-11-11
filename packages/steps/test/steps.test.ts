import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultParams, type Image, type Layers } from "@plotlab/engine";
import { allSteps, centerline, plot, threshold } from "../src/index.ts";
import { otsuLevel } from "../src/threshold/index.ts";
import { orderPaths } from "../src/plot/index.ts";
import { generate } from "../scripts/gen-help.ts";

const ctx = { paper: { widthMm: 100, heightMm: 100 }, pens: [{ id: "k", widthMm: 0.5, color: "#000" }], machine: "generic" };

function gray(w: number, h: number, f: (x: number, y: number) => number): Image {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { kind: "image", width: w, height: h, channels: 1, data, extent: { width: w, height: h } };
}

function maskLayers(w: number, h: number, f: (x: number, y: number) => boolean): Layers {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = f(x, y) ? 1 : 0;
  return { kind: "layers", extent: { width: w, height: h }, layers: [{ id: "l", name: "l", pen: "k", width: w, height: h, mask, levels: 2 }] };
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
    expect([...out.layers[0]!.mask]).toEqual([1, 1, 0, 0]);
    const inv = (await threshold.run(img, { mode: "fixed", level: 50, invert: true }, ctx)) as Layers;
    expect([...inv.layers[0]!.mask]).toEqual([0, 0, 1, 1]);
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

describe("plot", () => {
  it("fits geometry inside the margin and estimates time", async () => {
    const geo = await centerline.run(maskLayers(40, 11, (x, y) => x >= 2 && x < 38 && y >= 3 && y < 8), defaultParams(centerline.params), ctx);
    const out = await plot.run(geo, { margin: 10, order: "nearest", allowReverse: true }, ctx);
    for (const p of out.layers[0]!.paths) for (const [x, y] of p) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(90);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(90);
    }
    expect(out.timeEstimateS).toBeGreaterThan(0);
  });
  it("nearest-first ordering reverses strokes when closer", () => {
    const out = orderPaths([[[50, 0], [100, 0]], [[10, 0], [1, 0]]], true);
    expect(out[0]).toEqual([[1, 0], [10, 0]]);
  });
});
