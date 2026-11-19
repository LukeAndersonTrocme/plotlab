import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, type Image, type Ink, type Layers, type StepContext } from "@plotlab/engine";
import { dither } from "../src/index.ts";
import { bayerMatrix } from "../src/dither/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 };
const ctx: StepContext = { paper: { widthMm: 100, heightMm: 100 }, target: { kind: "raster", dpi: 300 }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const methods = ["floyd-steinberg", "atkinson", "bayer"] as const;

/** A grey image where `ink(x, y)` is the ink density (1 = black). 1 mm per pixel. */
function inkImage(w: number, h: number, inkAt: (x: number, y: number) => number): Image {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 1 - inkAt(x, y);
  return { kind: "image", width: w, height: h, channels: 1, data, frame: { xMm: 3, yMm: 4, widthMm: w, heightMm: h } };
}

async function run(img: Image, params: Record<string, unknown> = {}): Promise<Float32Array> {
  const out = (await applyStep(dither, img, { params: { ...defaultParams(dither.params), dotMm: 1, ...params } }, ctx)) as Layers;
  const v = out.layers[0]!.values;
  if (v.kind !== "tone") throw new Error("expected a tone layer");
  return v.data;
}
const onFraction = (d: Float32Array, from = 0, to = d.length) => {
  let n = 0;
  for (let i = from; i < to; i++) n += d[i]!;
  return n / (to - from);
};

describe("dither", () => {
  for (const method of methods) {
    describe(method, () => {
      it("gives about half the pixels ink on a flat 50% grey", async () => {
        const d = await run(inkImage(64, 64, () => 0.5), { method });
        expect(onFraction(d)).toBeGreaterThan(0.47);
        expect(onFraction(d)).toBeLessThan(0.53);
      });
      it("gives only 0 or 1, all off on white and all on on black", async () => {
        const white = await run(inkImage(16, 16, () => 0), { method });
        const black = await run(inkImage(16, 16, () => 1), { method });
        expect([...white].every((v) => v === 0)).toBe(true);
        expect([...black].every((v) => v === 1)).toBe(true);
        const mid = await run(inkImage(16, 16, (x) => x / 15), { method });
        expect([...mid].every((v) => v === 0 || v === 1)).toBe(true);
      });
      it("puts more ink where the tone is darker, step by step along a gradient", async () => {
        // Eight vertical strips from light to dark; each strip's on-fraction must grow.
        const strips = 8, sw = 16, h = 64;
        const img = inkImage(strips * sw, h, (x) => (Math.floor(x / sw) + 0.5) / strips);
        const d = await run(img, { method });
        const fr: number[] = [];
        for (let s = 0; s < strips; s++) {
          let n = 0;
          for (let y = 0; y < h; y++) for (let x = s * sw; x < (s + 1) * sw; x++) n += d[y * img.width + x]!;
          fr.push(n / (sw * h));
        }
        for (let s = 1; s < strips; s++) expect(fr[s]!, `strip ${s}: ${fr.join(", ")}`).toBeGreaterThan(fr[s - 1]!);
      });
      it("keeps the input's size and frame, as one on/off tone layer", async () => {
        const img = inkImage(13, 7, (x) => x / 12);
        const out = (await applyStep(dither, img, { params: { ...defaultParams(dither.params), method } }, ctx)) as Layers;
        expect([out.width, out.height]).toEqual([13, 7]);
        expect(out.frame).toEqual(img.frame);
        expect(out.layers).toHaveLength(1);
        expect(out.layers[0]!.values.kind).toBe("tone");
        expect(out.layers[0]!.values.data).toHaveLength(13 * 7);
      });
      it("is deterministic", async () => {
        const img = inkImage(20, 20, (x, y) => (x + y) / 38);
        expect(await run(img, { method })).toEqual(await run(img, { method }));
      });
    });
  }

  it("builds the classic Bayer matrices", () => {
    expect(bayerMatrix(2)).toEqual([0, 2, 3, 1]);
    expect(bayerMatrix(4)).toEqual([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
    expect([...bayerMatrix(8)].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it("Bayer 4×4 on 25% grey inks the four lowest cells of each tile", async () => {
    // Threshold at cell M is (M + 0.5) / 16, so 25% inks M = 0..3 only.
    const d = await run(inkImage(8, 4, () => 0.25), { method: "bayer", matrix: "4" });
    const row = (y: number) => [...d.slice(y * 8, y * 8 + 8)];
    expect(row(0)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(row(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row(2)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(row(3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("Bayer 4×4 on 50% grey inks the cells below 8", async () => {
    const d = await run(inkImage(4, 4, () => 0.5), { method: "bayer", matrix: "4" });
    expect([...d]).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1]);
  });

  it("Floyd–Steinberg on a tiny 40% grey matches the hand-worked result", async () => {
    // 3×2 at 0.4 ink. Worked by hand (ink when the running value ≥ 0.5):
    // (0,0) 0.4 → 0, err +0.4: b .575, d .525, e .425
    // (1,0) .575 → 1, err −.425: c .2140625, d .4453125, e .2921875, f .3734375
    // (2,0) .2140625 → 0: e .3323242, f .4403320
    // (0,1) .4453125 → 0: e .5271484 → 1, then f .2334595 → 0
    const d = await run(inkImage(3, 2, () => 0.4), { method: "floyd-steinberg", serpentine: false });
    expect([...d]).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it("serpentine Floyd–Steinberg mirrors the kernel on right-to-left rows (hand-worked)", async () => {
    // Same 3×2 at 0.4 ink. Row 0 as above leaves d .4453125, e .3323242, f .4403320.
    // Row 1 runs right to left, so "ahead" is to the left:
    // (2,1) f .4403320 → 0, err +.4403320 → e += 7/16 → .5249694 → 1, err −.4750306
    // → d += 7/16 → .2374866 → 0. Without the mirror, f's error would fall off the
    // right edge and e would stay at .3323242 → 0, giving [0,1,0,0,0,0].
    const d = await run(inkImage(3, 2, () => 0.4), { method: "floyd-steinberg", serpentine: true });
    expect([...d]).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it("serpentine scanning changes error diffusion but keeps the tone", async () => {
    const img = inkImage(48, 48, (x, y) => (x + y) / 94);
    const a = await run(img, { method: "floyd-steinberg", serpentine: false });
    const b = await run(img, { method: "floyd-steinberg", serpentine: true });
    expect(a).not.toEqual(b);
    expect(Math.abs(onFraction(a) - onFraction(b))).toBeLessThan(0.02);
  });

  it("dot size sets the physical size of a dither cell", async () => {
    // 1 mm per pixel and 4 mm dots: every 4×4 block is one value.
    const d = await run(inkImage(16, 16, (x) => x / 15), { method: "floyd-steinberg", dotMm: 4 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(d[y * 16 + x]).toBe(d[Math.floor(y / 4) * 4 * 16 + Math.floor(x / 4) * 4]);
    expect(new Set(d).size).toBe(2);
  });

  it("invert puts ink on the light areas", async () => {
    const d = await run(inkImage(8, 8, () => 0), { method: "atkinson", invert: true });
    expect([...d].every((v) => v === 1)).toBe(true);
  });
});
