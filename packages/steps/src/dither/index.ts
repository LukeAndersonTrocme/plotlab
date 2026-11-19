import { defineStep, luminance, type Layers } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/** Bayer's ordered-dither index matrix (row-major, values 0..n²-1), built recursively. */
export function bayerMatrix(n: number): number[] {
  let m = [0];
  for (let size = 1; size < n; size *= 2) {
    const next = new Array<number>(4 * size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * m[y * size + x]!;
        next[y * 2 * size + x] = v;
        next[y * 2 * size + x + size] = v + 2;
        next[(y + size) * 2 * size + x] = v + 3;
        next[(y + size) * 2 * size + x + size] = v + 1;
      }
    }
    m = next;
  }
  return m;
}

/** Error-diffusion kernels: [dx, dy, weight] for a left-to-right scan. */
const KERNELS: Record<"floyd-steinberg" | "atkinson", Array<[number, number, number]>> = {
  "floyd-steinberg": [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  // Atkinson spreads only 6/8 of the error, which keeps highlights and shadows clean.
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

/** Dither ink densities (0..1, w×h) to 0/1. Ink wherever the running value reaches one half. */
export function ditherTone(t: Float64Array, w: number, h: number, method: "floyd-steinberg" | "atkinson" | "bayer", matrix: number, serpentine: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (method === "bayer") {
    const m = bayerMatrix(matrix), n2 = matrix * matrix;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = t[y * w + x]! > (m[(y % matrix) * matrix + (x % matrix)]! + 0.5) / n2 ? 1 : 0;
    }
    return out;
  }
  const kernel = KERNELS[method];
  const v = Float64Array.from(t);
  for (let y = 0; y < h; y++) {
    const back = serpentine && y % 2 === 1;
    for (let k = 0; k < w; k++) {
      const x = back ? w - 1 - k : k;
      const i = y * w + x;
      const on = v[i]! >= 0.5 ? 1 : 0;
      out[i] = on;
      const err = v[i]! - on;
      for (const [dx, dy, wt] of kernel) {
        const nx = back ? x - dx : x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) v[ny * w + nx]! += err * wt;
      }
    }
  }
  return out;
}

export const dither = defineStep({
  id: "dither",
  version: 1,
  title: "Dither",
  summary: "Turn the image into one layer of on/off dots whose density follows the tones, like early computer graphics.",
  input: "image",
  output: "layers",
  cost: "live",
  params: {
    method: {
      type: "enum",
      label: "Method",
      help: "Error diffusion (Floyd–Steinberg, Atkinson) gives organic grain; ordered (Bayer) gives a regular cross-hatch pattern.",
      options: [
        { value: "floyd-steinberg", label: "Floyd–Steinberg" },
        { value: "atkinson", label: "Atkinson" },
        { value: "bayer", label: "Ordered (Bayer)" },
      ],
      default: "floyd-steinberg",
    },
    matrix: {
      type: "enum",
      label: "Pattern size",
      help: "Size of the repeating Bayer tile. Bigger tiles show more grey levels.",
      options: [
        { value: "2", label: "2 × 2" },
        { value: "4", label: "4 × 4" },
        { value: "8", label: "8 × 8" },
      ],
      default: "4",
      visibleWhen: { param: "method", equals: ["bayer"] },
    },
    serpentine: {
      type: "boolean",
      label: "Serpentine scan",
      help: "Scan alternate rows right to left, which breaks up diagonal worm patterns.",
      default: true,
      visibleWhen: { param: "method", equals: ["floyd-steinberg", "atkinson"] },
    },
    dotMm: { type: "number", label: "Dot size", help: "Width of one dither dot on the paper.", min: 0.1, max: 10, step: 0.1, default: 0.5, unit: "mm" },
    invert: { type: "boolean", label: "Invert", help: "Put ink on the light areas instead of the dark ones.", default: false },
  },
  help: help.dither ?? "",
  run(img, p): Layers {
    const { width: w, height: h } = img;
    const lum = luminance(img);
    // Average ink density over square cells of the dot size (ADR 0005), dither the cells,
    // then paint each cell back onto the full grid.
    const cell = Math.max(1, Math.round(p.dotMm / (img.frame.widthMm / w)));
    const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
    const sum = new Float64Array(cw * ch), count = new Float64Array(cw * ch);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = Math.floor(y / cell) * cw + Math.floor(x / cell);
        sum[c]! += p.invert ? lum[y * w + x]! : 1 - lum[y * w + x]!;
        count[c]! += 1;
      }
    }
    for (let c = 0; c < sum.length; c++) sum[c] = sum[c]! / count[c]!;
    const cells = ditherTone(sum, cw, ch, p.method as "floyd-steinberg" | "atkinson" | "bayer", Number(p.matrix), p.serpentine);
    // A 1-bit tone layer: 1 = ink, 0 = paper (ADR 0009), shaped like Threshold's.
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = cells[Math.floor(y / cell) * cw + Math.floor(x / cell)]!;
    return { kind: "layers", width: w, height: h, frame: img.frame, layers: [{ id: "dither", name: "Dither", values: { kind: "tone", data } }] };
  },
});
