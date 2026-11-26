import { describe, expect, it } from "vitest";
import { imageToRGBA, layerToRGBA, renderLaneThumbnail, renderThumbnail, type Position } from "../src/index.ts";

describe("imageToRGBA", () => {
  it("expands gray to opaque RGBA", () => {
    expect([...imageToRGBA({ width: 2, height: 1, channels: 1, data: new Float32Array([0, 1]) })]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
  it("keeps RGB", () => {
    expect([...imageToRGBA({ width: 1, height: 1, channels: 3, data: new Float32Array([1, 0.5, 0]) })]).toEqual([255, 128, 0, 255]);
  });
});

describe("layerToRGBA", () => {
  it("tints tone with the ink colour, alpha = density", () => {
    const l = { id: "a", name: "a", values: { kind: "tone" as const, data: new Float32Array([0.5]) } };
    expect([...layerToRGBA(l, 1, 1, "#ff0000")]).toEqual([255, 0, 0, 128]);
  });
  it("shows categories as steps of density; label 0 is clear", () => {
    const l = { id: "a", name: "a", values: { kind: "categories" as const, count: 2, data: new Uint16Array([0, 1, 2]) } };
    const px = layerToRGBA(l, 3, 1, "#000000");
    expect([px[3], px[7], px[11]]).toEqual([0, 128, 255]);
  });
});

describe("renderThumbnail", () => {
  const paper = { widthMm: 100, heightMm: 50 };
  const black = { id: "k", name: "Black", color: "#000000", mix: "multiply" as const, widthMm: 0.5 };
  const s = { paper, inks: [black], inkFor: () => black, passOrder: "light-to-dark" as const };
  const at = (t: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => [...t.rgba.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 3)];

  it("draws the whole paper, its long side at maxSide", () => {
    const img = { kind: "image" as const, width: 1, height: 1, channels: 1 as const, data: new Float32Array([0]), frame: { xMm: 0, yMm: 0, widthMm: 50, heightMm: 50 } };
    const t = renderThumbnail(img, s, 40);
    expect([t.width, t.height]).toEqual([40, 20]);
    // The image (black) on its frame, bare paper (white) elsewhere.
    expect(at(t, 5, 10)).toEqual([0, 0, 0]);
    expect(at(t, 35, 10)).toEqual([255, 255, 255]);
  });

  it("tints layers with their ink", () => {
    const red = { ...black, id: "r", color: "#ff0000" };
    const layers = { kind: "layers" as const, width: 1, height: 1, frame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 50 }, layers: [{ id: "a", name: "a", values: { kind: "tone" as const, data: new Float32Array([1]) } }] };
    const t = renderThumbnail(layers, { ...s, inks: [red], inkFor: () => red }, 20);
    expect(at(t, 10, 5)).toEqual([255, 0, 0]);
  });

  it("draws lines (traced order is fine) at least a pixel wide", () => {
    const geo = {
      kind: "geometry" as const,
      paper,
      layers: [{ id: "k", name: "k", features: { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [[0, 25], [100, 25]] as Position[] } }] } }],
    };
    const t = renderThumbnail(geo, s, 40);
    expect(at(t, 20, 10)[0]).toBeLessThan(128);
    expect(at(t, 20, 2)).toEqual([255, 255, 255]);
  });

  it("ignores the target's finishing: no mirror, no registration marks", () => {
    const img = { kind: "image" as const, width: 1, height: 1, channels: 1 as const, data: new Float32Array([0]), frame: { xMm: 0, yMm: 0, widthMm: 50, heightMm: 50 } };
    const t = renderThumbnail(img, { ...s, target: { kind: "plotter", mirror: true, registration: true } } as never, 40);
    expect(at(t, 5, 10)).toEqual([0, 0, 0]);
  });
});

describe("renderLaneThumbnail: one picture per ink, as a 2×2", () => {
  const paper = { widthMm: 100, heightMm: 100 };
  const ink = (id: string, color: string) => ({ id, name: id, color, mix: "multiply" as const, widthMm: 0.5 });
  const inks = { C: ink("c", "#00ffff"), M: ink("m", "#ff00ff"), Y: ink("y", "#ffff00"), K: ink("k", "#000000") };
  const s = { paper, inks: Object.values(inks), inkFor: (id: string) => inks[id as keyof typeof inks], passOrder: "light-to-dark" as const };
  const at = (t: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => [...t.rgba.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 3)];
  const full = (id: string) => ({ id, name: id, values: { kind: "tone" as const, data: new Float32Array([1]) } });

  it("C top left, M top right, Y bottom left, K bottom right, each ink alone on its own paper", () => {
    const layers = { kind: "layers" as const, width: 1, height: 1, frame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, layers: ["C", "M", "Y", "K"].map(full) };
    const t = renderLaneThumbnail(layers, s, 40, ["C", "M", "Y", "K"]);
    expect([t.width, t.height]).toEqual([40, 40]);
    expect(at(t, 10, 10)).toEqual([0, 255, 255]);
    expect(at(t, 30, 10)).toEqual([255, 0, 255]);
    expect(at(t, 10, 30)).toEqual([255, 255, 0]);
    expect(at(t, 30, 30)).toEqual([0, 0, 0]);
  });
  it("an ink with nothing at this stage is bare paper in its quarter", () => {
    const layers = { kind: "layers" as const, width: 1, height: 1, frame: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }, layers: [full("C")] };
    const t = renderLaneThumbnail(layers, s, 40, ["C", "M", "Y", "K"]);
    expect(at(t, 10, 10)).toEqual([0, 255, 255]);
    expect(at(t, 30, 30)).toEqual([255, 255, 255]);
  });
});
