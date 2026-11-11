import { describe, expect, it } from "vitest";
import { featurePaths, toPlot, type Geometry, type Ink, type PolygonFeature, type Position } from "../src/index.ts";

const square = (x: number, y: number, s: number): Position[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const poly: PolygonFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [square(0, 0, 10), square(3, 3, 4)] }, properties: { level: 2 } };
const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.3 };

describe("featurePaths", () => {
  it("returns each polygon ring closed", () => {
    const ps = featurePaths(poly);
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p[0]).toEqual(p[p.length - 1]);
  });
  it("returns a line's coordinates as one path", () => {
    expect(featurePaths({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} })).toEqual([[[0, 0], [1, 1]]]);
  });
});

describe("toPlot with polygons", () => {
  it("draws polygon outlines", () => {
    const geo: Geometry = { kind: "geometry", paper: { widthMm: 20, heightMm: 20 }, layers: [{ id: "b", name: "Bands", features: { type: "FeatureCollection", features: [poly] } }] };
    const p = toPlot(geo, { paper: geo.paper, inkFor: () => ink, passOrder: "light-to-dark" });
    expect(p.layers[0]!.paths).toHaveLength(2);
  });
});
