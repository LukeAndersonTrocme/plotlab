import type { Image } from "./types.ts";

/** Build an Image from 8-bit RGBA (canvas ImageData, pngjs, jpeg-js all give this). */
export function imageFromRGBA(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Image {
  const data = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    // Composite onto white so transparent areas read as paper.
    const a = (rgba[j + 3] ?? 255) / 255;
    data[i * 3] = ((rgba[j] ?? 0) / 255) * a + (1 - a);
    data[i * 3 + 1] = ((rgba[j + 1] ?? 0) / 255) * a + (1 - a);
    data[i * 3 + 2] = ((rgba[j + 2] ?? 0) / 255) * a + (1 - a);
  }
  return { kind: "image", width, height, channels: 3, data, extent: { width, height } };
}

/** Rec. 709 luminance, one value per pixel, 0..1. */
export function luminance(img: Image): Float32Array {
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

/**
 * Box-filter downscale so the longest side is at most `maxSide` pixels.
 * Used for low-res proxies while dragging. The extent is preserved.
 */
export function downscale(img: Image, maxSide: number): Image {
  const scale = Math.max(img.width, img.height) / maxSide;
  if (scale <= 1) return img;
  const w = Math.max(1, Math.round(img.width / scale));
  const h = Math.max(1, Math.round(img.height / scale));
  const c = img.channels;
  const out = new Float32Array(w * h * c);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      for (let ch = 0; ch < c; ch++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) sum += img.data[(yy * img.width + xx) * c + ch] ?? 0;
        out[(y * w + x) * c + ch] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
  }
  return { ...img, width: w, height: h, data: out };
}
