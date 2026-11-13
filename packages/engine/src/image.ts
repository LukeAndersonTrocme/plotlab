import type { RawImage } from "./types.ts";

/** Build an Image from 8-bit RGBA (canvas ImageData, pngjs, jpeg-js all give this). */
export function imageFromRGBA(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): RawImage {
  const data = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    // Composite onto white so transparent areas read as paper.
    const a = (rgba[j + 3] ?? 255) / 255;
    data[i * 3] = ((rgba[j] ?? 0) / 255) * a + (1 - a);
    data[i * 3 + 1] = ((rgba[j + 1] ?? 0) / 255) * a + (1 - a);
    data[i * 3 + 2] = ((rgba[j + 2] ?? 0) / 255) * a + (1 - a);
  }
  return { width, height, channels: 3, data };
}

/** Rec. 709 luminance, one value per pixel, 0..1. */
export function luminance(img: RawImage): Float32Array {
  const n = img.width * img.height;
  if (img.channels === 1) return img.data;
  const out = new Float32Array(n);
  const c = img.channels;
  for (let i = 0; i < n; i++) {
    const r = img.data[i * c] ?? 0;
    const g = img.data[i * c + 1] ?? 0;
    const b = img.data[i * c + 2] ?? 0;
    out[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}
