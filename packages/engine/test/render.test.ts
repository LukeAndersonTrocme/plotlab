import { describe, expect, it } from "vitest";
import { imageToRGBA, layerToRGBA } from "../src/index.ts";

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
