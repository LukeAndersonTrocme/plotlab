import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, type Image, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { allSteps, cmyk } from "../src/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 10, heightMm: 10 }, target: { kind: "plotter" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const frame = { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 };

/** A one-row RGB image, one pixel per [r, g, b]. */
const rgb = (...px: Array<[number, number, number]>): Image => ({ kind: "image", width: px.length, height: 1, channels: 3, data: Float32Array.from(px.flat()), frame });

async function separate(img: Image, blackGeneration: number) {
  const out = (await applyStep(cmyk, img, { params: { ...defaultParams(cmyk.params), blackGeneration } }, ctx)) as Layers;
  const at = (id: string, i = 0) => {
    const l = out.layers.find((x) => x.id === id)!;
    if (l.values.kind !== "tone") throw new Error("expected tone");
    return l.values.data[i]!;
  };
  return { out, at };
}

describe("cmyk (Separate CMYK)", () => {
  it("makes four tone layers with stable ids C, M, Y, K", async () => {
    const { out } = await separate(rgb([0.5, 0.5, 0.5]), 0.5);
    expect(out.layers.map((l) => [l.id, l.name, l.values.kind])).toEqual([
      ["C", "Cyan", "tone"],
      ["M", "Magenta", "tone"],
      ["Y", "Yellow", "tone"],
      ["K", "Black", "tone"],
    ]);
    expect(out.frame).toEqual(frame);
  });

  it("more black generation raises K and lowers C, M and Y on the same pixel", async () => {
    const px: [number, number, number] = [0.45, 0.3, 0.2];
    const low = await separate(rgb(px), 0.2);
    const high = await separate(rgb(px), 0.8);
    expect(high.at("K")).toBeGreaterThan(low.at("K"));
    for (const id of ["C", "M", "Y"]) expect(high.at(id), id).toBeLessThan(low.at(id));
  });

  it("with no black generation, C, M and Y are 1 − R, G, B and K is empty", async () => {
    const { at } = await separate(rgb([0.25, 0.5, 1]), 0);
    expect([at("C"), at("M"), at("Y"), at("K")]).toEqual([0.75, 0.5, 0, 0]);
  });

  it("full black generation puts a grey entirely in K", async () => {
    const { at } = await separate(rgb([0.4, 0.4, 0.4]), 1);
    expect(at("K")).toBeCloseTo(0.6, 6);
    for (const id of ["C", "M", "Y"]) expect(at(id), id).toBeCloseTo(0, 6);
  });

  it("the four inks printed over each other give back the pixel, at any black generation", async () => {
    const px: [number, number, number] = [0.7, 0.35, 0.1];
    for (const bg of [0, 0.3, 0.5, 1]) {
      const { at } = await separate(rgb(px), bg);
      const k = 1 - at("K");
      expect((1 - at("C")) * k, `r @ ${bg}`).toBeCloseTo(px[0], 5);
      expect((1 - at("M")) * k, `g @ ${bg}`).toBeCloseTo(px[1], 5);
      expect((1 - at("Y")) * k, `b @ ${bg}`).toBeCloseTo(px[2], 5);
    }
  });

  it("pure black is all K and leaves C, M and Y empty", async () => {
    const { at } = await separate(rgb([0, 0, 0]), 1);
    expect([at("C"), at("M"), at("Y"), at("K")]).toEqual([0, 0, 0, 1]);
  });

  it("treats a grey image as R = G = B", async () => {
    const grey: Image = { kind: "image", width: 1, height: 1, channels: 1, data: Float32Array.from([0.4]), frame };
    const a = await separate(grey, 0.5);
    const b = await separate(rgb([0.4, 0.4, 0.4]), 0.5);
    for (const id of ["C", "M", "Y", "K"]) expect(a.at(id), id).toBeCloseTo(b.at(id), 6);
  });

  it("names cyan, magenta, yellow and black as the default inks for its layers", () => {
    const inks = cmyk.layerInks!;
    expect(Object.keys(inks)).toEqual(["C", "M", "Y", "K"]);
    expect(Object.values(inks).map((i) => i.id)).toEqual(["cyan", "magenta", "yellow", "black"]);
    for (const i of Object.values(inks)) expect(i.mix).toBe("multiply");
  });

  it("is registered", () => {
    expect(allSteps).toContain(cmyk);
  });
});
