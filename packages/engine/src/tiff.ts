import * as utifModule from "utif2";
import { imageFromRGBA } from "./image.ts";
import type { RawImage } from "./types.ts";

// utif2 is CommonJS: Node ESM puts it under `default`, bundlers and Vitest don't.
const UTIF = ((utifModule as unknown as { default?: typeof utifModule }).default ?? utifModule) as typeof utifModule;

/**
 * Decode every page of a TIFF into RawImages, keeping 16-bit precision (the Float32 image
 * holds it). Gray, RGB and RGBA at 1/8/16 bits are read directly; anything else (palette,
 * CMYK, odd depths) goes through UTIF's 8-bit RGBA conversion.
 */
export function decodeTiff(bytes: Uint8Array): RawImage[] {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buf).filter((ifd) => ifd["t256"] && ifd["t257"]);
  if (ifds.length === 0) throw new Error("this TIFF has no images in it");
  return ifds.map((ifd) => {
    UTIF.decodeImage(buf, ifd);
    const w = ifd.width, h = ifd.height;
    const bps = (ifd["t258"] as number[] | undefined)?.[0] ?? 1;
    const spp = (ifd["t277"] as number[] | undefined)?.[0] ?? 1;
    const photo = (ifd["t262"] as number[] | undefined)?.[0] ?? (spp >= 3 ? 2 : 1);
    const direct = (photo === 0 || photo === 1 || photo === 2) && [1, 8, 16].includes(bps) && [1, 2, 3, 4].includes(spp) && !(bps === 1 && spp > 1);
    if (!direct) return imageFromRGBA(w, h, new Uint8Array(UTIF.toRGBA8(ifd)));
    const src = ifd.data;
    // Gray + alpha drops the alpha; RGB(A) keeps it.
    const outCh: 1 | 3 | 4 = spp <= 2 ? 1 : spp === 3 ? 3 : 4;
    const data = new Float32Array(w * h * outCh);
    const stride = Math.ceil((w * spp * bps) / 8);
    const sample = (x: number, y: number, c: number): number => {
      const i = x * spp + c;
      if (bps === 8) return src[y * stride + i]! / 255;
      if (bps === 16) {
        const o = y * stride + i * 2; // UTIF converts 16-bit to little endian
        return (src[o]! | (src[o + 1]! << 8)) / 65535;
      }
      return (src[y * stride + (i >> 3)]! >> (7 - (i & 7))) & 1;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < outCh; c++) {
          const v = sample(x, y, c);
          data[(y * w + x) * outCh + c] = photo === 0 ? 1 - v : v;
        }
    return { width: w, height: h, channels: outCh, data };
  });
}

/** True if the bytes start with a TIFF header (II*\0 or MM\0*). */
export function isTiff(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42);
}
