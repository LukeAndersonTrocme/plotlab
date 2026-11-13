import { describe, expect, it } from "vitest";
import { applyStep, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { pixelate } from "../src/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 10, heightMm: 10 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const frame = { xMm: 0, yMm: 0, widthMm: 4, heightMm: 4 }; // 1 mm per pixel
const grid = (values: Layers["layers"][number]["values"]): Layers => ({ kind: "layers", width: 4, height: 4, frame, layers: [{ id: "l", name: "L", values }] });

describe("pixelate", () => {
  it("averages tone in each cell, keeping the grid", async () => {
    const data = Float32Array.from({ length: 16 }, (_, i) => i / 15);
    const out = (await applyStep(pixelate, grid({ kind: "tone", data }), { params: { sizing: "mm", cellMm: 2, across: 40 } }, ctx)) as Layers;
    const d = out.layers[0]!.values.data;
    expect(out.width).toBe(4);
    const block = (x: number, y: number) => [d[y * 4 + x], d[y * 4 + x + 1], d[(y + 1) * 4 + x], d[(y + 1) * 4 + x + 1]];
    const tl = block(0, 0);
    expect(new Set(tl).size).toBe(1);
    expect(tl[0]).toBeCloseTo((0 + 1 + 4 + 5) / 4 / 15, 6);
  });
  it("takes the most common label for categories, and sizes by cells across", async () => {
    const data = Uint16Array.from([1, 1, 2, 2, 1, 2, 2, 2, 3, 3, 1, 1, 3, 1, 1, 1]);
    const out = (await applyStep(pixelate, grid({ kind: "categories", data, count: 3 }), { params: { sizing: "across", cellMm: 5, across: 2 } }, ctx)) as Layers;
    const v = out.layers[0]!.values;
    expect([v.data[0], v.data[2], v.data[8], v.data[10]]).toEqual([1, 2, 3, 1]);
    expect(v.kind === "categories" && v.count).toBe(3);
  });
});
