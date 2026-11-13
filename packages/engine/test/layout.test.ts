import { describe, expect, it } from "vitest";
import { MAX_WORKING_SIDE, placeOnPaper, pxToMm, resample, workingSize } from "../src/index.ts";

const paper = { widthMm: 100, heightMm: 100 };
const src = { width: 200, height: 100 };

describe("placeOnPaper", () => {
  it("fit keeps the whole image inside the margin box, centred", () => {
    const { frame, crop } = placeOnPaper(src, paper, { fit: "fit", marginMm: 10, position: [0.5, 0.5] });
    expect(frame).toEqual({ xMm: 10, yMm: 30, widthMm: 80, heightMm: 40 });
    expect(crop).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
  it("fill covers the box and crops the overflow around the anchor", () => {
    const c = placeOnPaper(src, paper, { fit: "fill", marginMm: 10, position: [0.5, 0.5] });
    expect(c.frame).toEqual({ xMm: 10, yMm: 10, widthMm: 80, heightMm: 80 });
    expect(c.crop).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    const l = placeOnPaper(src, paper, { fit: "fill", marginMm: 10, position: [0, 0.5] });
    expect(l.crop.x).toBe(0);
  });
});

describe("workingSize", () => {
  const frame = { xMm: 10, yMm: 30, widthMm: 80, heightMm: 40 };
  const crop = { x: 0, y: 0, w: 200, h: 100 };
  it("never upsamples beyond the source", () => {
    expect(workingSize(frame, crop, 0.25)).toEqual({ width: 200, height: 100, warnings: [] });
  });
  it("uses the requested mm per pixel when coarser than the source", () => {
    expect(workingSize(frame, crop, 1)).toEqual({ width: 80, height: 40, warnings: [] });
  });
  it("caps huge working images with a warning", () => {
    const big = workingSize({ xMm: 0, yMm: 0, widthMm: 297, heightMm: 210 }, { x: 0, y: 0, w: 1e5, h: 1e5 }, 0.01);
    expect(Math.max(big.width, big.height)).toBe(MAX_WORKING_SIDE);
    expect(big.warnings).toHaveLength(1);
    expect(big.warnings[0]).toMatch(/capped/);
  });
});

describe("resample", () => {
  it("box-filters a checkerboard to flat grey", () => {
    const data = new Float32Array(16).map((_, i) => ((i % 4) + Math.floor(i / 4)) % 2);
    const out = resample({ width: 4, height: 4, channels: 1, data }, { x: 0, y: 0, w: 4, h: 4 }, 2, 2);
    expect([...out]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it("copies a crop 1:1", () => {
    const data = new Float32Array([0, 1, 2, 3, 4, 5]);
    const out = resample({ width: 3, height: 2, channels: 1, data }, { x: 1, y: 0, w: 2, h: 2 }, 2, 2);
    expect([...out]).toEqual([1, 2, 4, 5]);
  });
});

describe("pxToMm", () => {
  it("maps pixel centres into the frame", () => {
    expect(pxToMm({ xMm: 10, yMm: 30, widthMm: 80, heightMm: 40 }, 80, 40, 0, 0)).toEqual([10.5, 30.5]);
  });
});
