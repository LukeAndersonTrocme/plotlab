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

/** The stage with only one layer left (lines, layers and the layers that aren't lines yet). */
function onlyLayer(data: StageData, id: string): StageData {
  const keep = <L extends { id: string }>(ls: L[]) => ls.filter((l) => l.id === id);
  switch (data.kind) {
    case "image":
      return data;
    case "layers":
      return { ...data, layers: keep(data.layers) };
    case "geometry":
    case "plot": {
      const rest = data.rasterLayers ? { rasterLayers: { ...data.rasterLayers, layers: keep(data.rasterLayers.layers) } } : {};
      return { ...data, layers: keep(data.layers as Array<{ id: string }>), ...rest } as StageData;
    }
  }
}

/**
 * A lane thumbnail (#66): each ink alone on its own small paper, tiled 2×2 in the order given
 * (C top left, M top right, Y bottom left, K bottom right), so one strip box shows every ink.
 * Each quarter's long side is `maxSide / 2`. RGBA bytes.
 */
export function renderLaneThumbnail(data: StageData, s: ThumbnailSettings, maxSide: number, layers: string[]): { width: number; height: number; rgba: Uint8ClampedArray } {
  const half = Math.max(1, Math.floor(maxSide / 2));
  const quarters = layers.slice(0, 4).map((id) => renderThumbnail(onlyLayer(data, id), s, half));
  const qw = quarters[0]?.width ?? half, qh = quarters[0]?.height ?? half;
  const width = qw * 2, height = qh * 2;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  quarters.forEach((q, k) => {
    const ox = (k % 2) * qw, oy = Math.floor(k / 2) * qh;
    for (let y = 0; y < Math.min(qh, q.height); y++) rgba.set(q.rgba.subarray(y * q.width * 4, (y * q.width + Math.min(qw, q.width)) * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, rgba };
}

/** One ink alone on the paper (a box in an independent lane, #66). RGBA bytes. */
export function renderInkThumbnail(data: StageData, s: ThumbnailSettings, maxSide: number, layer: string): { width: number; height: number; rgba: Uint8ClampedArray } {
  return renderThumbnail(onlyLayer(data, layer), s, maxSide);
}
