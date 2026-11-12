import { describe, expect, it } from "vitest";
import { applyStep, featurePaths, type Geometry, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { bands } from "../src/index.ts";
import { ringArea } from "../src/bands/trace.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 20, heightMm: 20 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const input: Layers = {
  kind: "layers",
  width: 10,
  height: 10,
  frame: { xMm: 5, yMm: 5, widthMm: 10, heightMm: 10 },
  layers: [
    {
      id: "tone",
      name: "Ink density",
      values: { kind: "categories", count: 2, data: Uint16Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 1 : 2)), bands: [{ lo: 0, hi: 0.5 }, { lo: 0.5, hi: 1 }] },
    },
  ],
};

describe("bands", () => {
  it("areas: one polygon per band, tagged with level and tone range, covering the frame in mm", async () => {
    const geo = (await applyStep(bands, input, { params: { mode: "areas", simplify: 0 } }, ctx)) as Geometry;
    const feats = geo.layers[0]!.features.features;
    expect(feats.map((f) => f.properties.level).sort()).toEqual([1, 2]);
    expect(feats.find((f) => f.properties.level === 2)!.properties).toMatchObject({ toneLo: 0.5, toneHi: 1 });
    const total = feats.reduce((s, f) => s + Math.abs(ringArea(f.geometry.coordinates[0] as never)), 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThanOrEqual(100);
    for (const f of feats) for (const [x, y] of featurePaths(f)[0]!) {
      expect(x).toBeGreaterThanOrEqual(5);
      expect(x).toBeLessThanOrEqual(15);
      expect(y).toBeGreaterThanOrEqual(5);
      expect(y).toBeLessThanOrEqual(15);
    }
  });
  it("contours: one line between the bands", async () => {
    const geo = (await applyStep(bands, input, { params: { mode: "contours", simplify: 0.2 } }, ctx)) as Geometry;
    const feats = geo.layers[0]!.features.features;
    expect(feats).toHaveLength(1);
    expect(feats[0]!.geometry.type).toBe("LineString");
    for (const [x] of featurePaths(feats[0]!)[0]!) expect(x).toBeCloseTo(10, 5);
  });
  it("refuses tone layers with a plain reason", async () => {
    const t: Layers = { ...input, layers: [{ id: "t", name: "Ink density", values: { kind: "tone", data: new Float32Array(100) } }] };
    await expect(applyStep(bands, t, { params: { mode: "areas", simplify: 0 } }, ctx)).rejects.toThrow(/holds tone.*Levels/);
  });
});
