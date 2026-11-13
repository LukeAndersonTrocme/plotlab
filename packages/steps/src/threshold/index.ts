import { defineStep, luminance, type Layers } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/** Otsu's method: the level that best separates the histogram into two classes. */
export function otsuLevel(lum: Float32Array, bins = 256): number {
  const hist = new Float64Array(bins);
  for (const v of lum) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]! += 1;
  const total = lum.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i]!;
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < bins; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return (best + 1) / bins;
}

export const threshold = defineStep({
  id: "threshold",
  version: 2,
  title: "Threshold",
  summary: "Turn the image into one black-and-white layer: everything darker than a level gets ink.",
  input: "image",
  output: "layers",
  cost: "live",
  params: {
    mode: {
      type: "enum",
      label: "Mode",
      help: "Pick the level yourself, or let the image choose it (Otsu).",
      options: [
        { value: "fixed", label: "Fixed level" },
        { value: "auto", label: "Automatic (Otsu)" },
      ],
      default: "fixed",
    },
    level: {
      type: "number",
      label: "Level",
      help: "Pixels darker than this get ink. 0 = black, 100 = white.",
      min: 0,
      max: 100,
      step: 1,
      default: 50,
      unit: "%",
      visibleWhen: { param: "mode", equals: ["fixed"] },
    },
    invert: {
      type: "boolean",
      label: "Invert",
      help: "Put ink on the light areas instead of the dark ones.",
      default: false,
    },
  },
  help: help.threshold ?? "",
  run(img, p): Layers {
    const lum = luminance(img);
    const level = p.mode === "auto" ? otsuLevel(lum) : p.level / 100;
    // A 1-bit tone layer: 1 = ink, 0 = paper (ADR 0009).
    const data = new Float32Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) data[i] = lum[i]! < level !== p.invert ? 1 : 0;
    return {
      kind: "layers",
      width: img.width,
      height: img.height,
      frame: img.frame,
      layers: [{ id: "threshold", name: "Threshold", values: { kind: "tone", data } }],
    };
  },
  migrate: (params) => ({ params, note: "The layer is now a 1-bit tone layer; output is unchanged." }),
});
