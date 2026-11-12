import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, type GeoFeature, type Geometry, type Ink, type Position, type StepContext } from "@plotlab/engine";
import { fill } from "../src/index.ts";
import { bandPattern } from "../src/fill/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 40, heightMm: 40 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const rect = (x: number, y: number, w: number, h: number): Position[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const band = (level: number, x: number, count = 3): GeoFeature => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [rect(x, 0.5, 10, 10)] },
  properties: { level, toneLo: (level - 1) / count, toneHi: level / count },
});
const geo = (features: GeoFeature[]): Geometry => ({ kind: "geometry", paper: ctx.paper, layers: [{ id: "b", name: "Bands", features: { type: "FeatureCollection", features } }] });
const P = { ...defaultParams(fill.params) };
const run = async (features: GeoFeature[], params: Partial<typeof P> = {}) =>
  ((await applyStep(fill, geo(features), { params: { ...P, ...params } }, ctx)) as Geometry).layers[0]!.features.features;

describe("bandPattern", () => {
  it("continuous: darker bands get denser lines", () => {
    expect(bandPattern(3, 0.9, 3, P).spacing).toBeLessThan(bandPattern(2, 0.4, 3, P).spacing);
  });
  it("cycle: horizontal, vertical, then the diagonals (old R pattern)", () => {
    const p = { ...P, mapping: "cycle", skipLightest: true };
    expect([2, 3, 4, 5].map((l) => bandPattern(l, 0.5, 5, p).angle)).toEqual([0, 90, 45, 135]);
  });
  it("an override for one band wins", () => {
    const p = { ...P, overrides: { "3": { spacing: 7, angle: 12 } } };
    expect(bandPattern(3, 0.9, 3, p)).toEqual({ spacing: 7, angle: 12 });
  });
});

describe("fill", () => {
  it("leaves the lightest band as paper by default", async () => {
    const out = await run([band(1, 0), band(2, 12)]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((f) => f.properties.level === 2)).toBe(true);
  });
  it("cumulative cross-hatch adds lighter bands' lines to darker bands", async () => {
    const plain = (await run([band(2, 0), band(3, 12)])).filter((f) => f.properties.level === 3).length;
    const cum = (await run([band(2, 0), band(3, 12)], { cumulative: true })).filter((f) => f.properties.level === 3).length;
    expect(cum).toBeGreaterThan(plain);
  });
  it("dots instead of lines", async () => {
    const out = await run([band(3, 0)], { kind: "dots" });
    expect(out.length).toBeGreaterThan(4);
    expect(out.every((f) => f.geometry.type === "LineString")).toBe(true);
  });
  it("keeps outlines when asked, and passes contour lines through", async () => {
    const line: GeoFeature = { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [5, 5]] }, properties: { level: 1 } };
    const out = await run([band(2, 0), line], { outline: true });
    expect(out).toContainEqual(line);
    expect(out.some((f) => f.geometry.type === "Polygon")).toBe(true);
  });
  it("copes with a huge number of tiny bands (speckled images)", async () => {
    const many = Array.from({ length: 200000 }, (_, i): GeoFeature => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [rect(i % 400, Math.floor(i / 400) * 0.01, 0.05, 0.005)] },
      properties: { level: (i % 3) + 1 },
    }));
    await expect(run(many)).resolves.toBeDefined();
  });
});

