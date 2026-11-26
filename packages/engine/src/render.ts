import { parseColor, toPlot, type PassOrder } from "./project.ts";
import { composite, renderPlates } from "./raster.ts";
import type { Ink, Layer, Paper, RawImage, StageData } from "./types.ts";

/** Pixels for showing a stage (ADR 0009 inspection). Pure, so it runs in workers and tests. */

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function imageToRGBA(img: RawImage): Uint8ClampedArray {
  const n = img.width * img.height, c = img.channels;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const r = img.data[i * c]!;
    out[i * 4] = byte(r);
    out[i * 4 + 1] = byte(c === 1 ? r : img.data[i * c + 1]!);
    out[i * 4 + 2] = byte(c === 1 ? r : img.data[i * c + 2]!);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A layer tinted in its ink colour; alpha = density (tone) or label / count (categories). */
export function layerToRGBA(layer: Layer, width: number, height: number, color: string): Uint8ClampedArray {
  const [r, g, b] = parseColor(color) ?? [0, 0, 0];
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const v = layer.values;
  for (let i = 0; i < n; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = v.kind === "tone" ? byte(v.data[i]!) : byte(v.data[i]! / v.count);
  }
  return out;
}

/** What a thumbnail needs from the recipe: the paper and who inks which layer. */
export interface ThumbnailSettings {
  paper: Paper;
  inks: Ink[];
  inkFor(layerId: string): Ink;
  passOrder: PassOrder;
}

/**
 * A small picture of any stage's data on the paper (the step strip, preset gallery and
 * checkpoints use it): the image, layers tinted in their inks, and lines in traced or
 * stroke order, mixed like the export. The long side of the paper is `maxSide` pixels.
 * Finishing (mirror, registration marks) is left out: a thumbnail shows the work. RGBA bytes.
 */
export function renderThumbnail(data: StageData, s: ThumbnailSettings, maxSide: number): { width: number; height: number; rgba: Uint8ClampedArray } {
  const dpi = (maxSide * 25.4) / Math.max(s.paper.widthMm, s.paper.heightMm);
  const plot = data.kind === "plot" ? data : data.kind === "geometry" ? toPlot(data, s) : null;
  const r = renderPlates(data, plot, { ...s, target: { kind: "vector" } }, dpi);
  return { width: r.width, height: r.height, rgba: composite(r) };
}
