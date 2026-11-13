import { defineStep, type Layer } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/**
 * Cut points in (0, 1) splitting tone into bands. Quantile cuts give each band about the
 * same area; where many pixels share one value (a white background) the cut lands just
 * above that value and the remaining bands split what's left, so bands are never empty.
 */
export function cutPoints(values: Float32Array, count: number, method: "quantile" | "equal" | "custom", custom: number[]): number[] {
  if (method === "custom") {
    return [...new Set(custom.map((c) => c / 100).filter((c) => c > 0 && c < 1))].sort((a, b) => a - b);
  }
  if (method === "equal") return Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);
  const sorted = Float32Array.from(values).sort();
  const cuts: number[] = [];
  let start = 0;
  for (let b = count; b >= 2 && start < sorted.length; b--) {
    const c = sorted[start + Math.ceil((sorted.length - start) / b) - 1]!;
    let end = start;
    while (end < sorted.length && sorted[end]! <= c) end++;
    if (end >= sorted.length) break;
    const cut = (c + sorted[end]!) / 2;
    if (cut > 0 && cut < 1) cuts.push(cut);
    start = end;
  }
  return cuts;
}

/** Approximate Gaussian blur: three box passes per axis, edges repeated. */
export function blurTone(data: Float32Array, w: number, h: number, sigmaPx: number): Float32Array {
  const r = Math.round((Math.sqrt(4 * sigmaPx * sigmaPx + 1) - 1) / 2);
  if (r < 1) return data;
  let a = Float32Array.from(data);
  let b = new Float32Array(data.length);
  const pass = (src: Float32Array, dst: Float32Array, n: number, lines: number, stride: number, step: number) => {
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      let sum = 0;
      const at = (i: number) => src[base + Math.min(n - 1, Math.max(0, i)) * step]!;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < n; i++) {
        dst[base + i * step] = sum / (2 * r + 1);
        sum += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(a, b, w, h, w, 1);
    [a, b] = [b, a];
    pass(a, b, h, w, 1, w);
    [a, b] = [b, a];
  }
  return a;
}

export const levels = defineStep({
  id: "levels",
  version: 1,
  title: "Levels",
  summary: "Split ink density into a few bands, from lightest to darkest, like contour levels on a map.",
  input: "layers",
  output: "layers",
  cost: "live",
  accepts: ["tone"],
  params: {
    count: { type: "number", label: "Bands", help: "How many bands to cut the tones into.", min: 2, max: 12, step: 1, default: 5, visibleWhen: { param: "method", equals: ["quantile", "equal"] } },
    method: {
      type: "enum",
      label: "Cut by",
      help: "Equal area gives every band about the same amount of the picture. Equal steps cut the tone scale evenly.",
      options: [
        { value: "quantile", label: "Equal area" },
        { value: "equal", label: "Equal steps" },
        { value: "custom", label: "My own cut points" },
      ],
      default: "quantile",
    },
    cuts: {
      type: "text",
      label: "Cut points (%)",
      help: "Ink density percentages where one band ends and the next begins, e.g. 20, 45, 70.",
      default: "25, 50, 75",
      placeholder: "20, 45, 70",
      visibleWhen: { param: "method", equals: ["custom"] },
    },
    smoothing: { type: "number", label: "Smooth first", help: "Blur the tones before cutting, so band edges are smoother and less speckled.", min: 0, max: 5, step: 0.1, default: 0.5, unit: "mm" },
  },
  help: help.levels ?? "",
  runLayer(layer, p, _ctx, grid): Layer {
    if (layer.values.kind !== "tone") throw new Error("unreachable: levels accepts tone");
    const mmPerPx = grid.frame.widthMm / grid.width;
    const t = blurTone(layer.values.data, grid.width, grid.height, p.smoothing / mmPerPx);
    const custom = p.cuts.split(/[,;\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));
    const cuts = cutPoints(t, p.count, p.method as "quantile" | "equal" | "custom", custom);
    const data = new Uint16Array(t.length);
    for (let i = 0; i < t.length; i++) {
      let lo = 0, hi = cuts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cuts[mid]! < t[i]!) lo = mid + 1;
        else hi = mid;
      }
      data[i] = lo + 1;
    }
    const edges = [0, ...cuts, 1];
    const bands = cuts.map((_, i) => ({ lo: edges[i]!, hi: edges[i + 1]! })).concat([{ lo: edges[cuts.length]!, hi: 1 }]);
    return { ...layer, values: { kind: "categories", data, count: cuts.length + 1, bands } };
  },
});
