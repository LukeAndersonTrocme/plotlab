import * as utifModule from "utif2";
import { imageFromRGBA, luminance } from "./image.ts";
import type { Layer, RawImage, RawLayers } from "./types.ts";

// utif2 is CommonJS: Node ESM puts it under `default`, bundlers and Vitest don't.
const UTIF = ((utifModule as unknown as { default?: typeof utifModule }).default ?? utifModule) as typeof utifModule;

/**
 * Decode every page of a TIFF into RawImages, keeping 16-bit precision (the Float32 image
 * holds it). Gray, RGB and RGBA at 1/8/16 bits are read directly; anything else (palette,
 * CMYK, odd depths) goes through UTIF's 8-bit RGBA conversion.
 */
export function decodeTiff(bytes: Uint8Array): RawImage[] {
  return readPages(bytes).map((p) => p.decode());
}

type Ifd = ReturnType<typeof UTIF.decode>[number];

/** A page's tags, read up front; pixels are decoded only when asked for. */
interface Page {
  width: number;
  height: number;
  decode(): RawImage;
  /** The PageName tag, if the file has one. */
  name: string | null;
  /** A reduced-resolution copy (thumbnail/preview) of another page. */
  reduced: boolean;
}

function readPages(bytes: Uint8Array): Page[] {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buf).filter((ifd) => ifd["t256"] && ifd["t257"]);
  if (ifds.length === 0) throw new Error("this TIFF has no images in it");
  return ifds.map((ifd) => {
    const raw = ifd["t285"] as string[] | string | undefined;
    const name = (Array.isArray(raw) ? raw[0] : raw)?.replace(/\0+$/, "").trim() || null;
    const reduced = ((ifd["t254"] as number[] | undefined)?.[0] ?? 0) & 1 ? true : false;
    const dim = (t: string) => (ifd[t] as number[])[0]!;
    return { width: dim("t256"), height: dim("t257"), decode: () => decodeIfd(buf, ifd), name, reduced };
  });
}

function decodeIfd(buf: ArrayBuffer, ifd: Ifd): RawImage {
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
}

/**
 * A multi-page TIFF as separations (ADR 0009): one tone layer per page, dark = ink.
 * Every page must share one size. Layer names come from PageName tags, else "Page N".
 * Reduced-resolution pages (thumbnails) are skipped.
 */
export function decodeTiffLayers(bytes: Uint8Array): RawLayers {
  return pagesToLayers(fullPages(bytes));
}

/** Pages that aren't reduced-resolution previews (all of them, if that would leave none). Thumbnails are never decoded. */
function fullPages(bytes: Uint8Array): Page[] {
  const pages = readPages(bytes);
  const full = pages.filter((p) => !p.reduced);
  return full.length ? full : pages;
}

function pagesToLayers(pages: Page[]): RawLayers {
  // Sizes come from the tags, so a mismatch is reported before any pixels are decoded.
  const first = pages[0]!;
  pages.forEach((p, i) => {
    if (p.width !== first.width || p.height !== first.height) {
      throw new Error(
        `this TIFF's pages differ in size (page ${i + 1} is ${p.width} × ${p.height} px, page 1 is ${first.width} × ${first.height} px). ` +
          "Separations must share one size to line up as layers.",
      );
    }
  });
  const used = new Set<string>();
  const layers: Layer[] = pages.map((p, i) => {
    let id = (p.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `page-${i + 1}`;
    if (used.has(id)) id = `${id}-${i + 1}`;
    used.add(id);
    const lum = luminance(p.decode());
    const data = new Float32Array(lum.length);
    for (let j = 0; j < data.length; j++) data[j] = Math.min(1, Math.max(0, 1 - lum[j]!));
    return { id, name: p.name ?? `Page ${i + 1}`, values: { kind: "tone", data } };
  });
  return { kind: "layers", width: first.width, height: first.height, layers };
}

/** A TIFF as a source: one page enters as an image, several enter as layers (separations). */
export function decodeTiffSource(bytes: Uint8Array): RawImage | RawLayers {
  const pages = fullPages(bytes);
  return pages.length === 1 ? pages[0]!.decode() : pagesToLayers(pages);
}

/** True if the bytes start with a TIFF header (II*\0 or MM\0*). */
export function isTiff(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42);
}
