import { parseColor } from "./project.ts";
import type { Layer, RawImage } from "./types.ts";

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
