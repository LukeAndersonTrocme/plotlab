import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { decodeTiffSource, imageFromRGBA, parseSvg, sourceStage, type RawImage, type Source } from "@plotlab/engine";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export const INPUT_FORMATS = ".png, .jpg, .webp, .tif, .svg";

/** libwebp compiled to WASM (no native build). Loaded on first use: it compiles the module. */
type WebpDecode = (data: Uint8Array) => { width: number; height: number; data: Uint8ClampedArray };
let webp: WebpDecode | null = null;
function decodeWebp(buf: Uint8Array) {
  webp ??= (createRequire(import.meta.url)("@cwasm/webp") as { decode: WebpDecode }).decode;
  return webp(buf);
}

/**
 * Decode a source file: PNG, JPEG, WebP and single-page TIFF (8/16-bit) enter as an image;
 * a multi-page TIFF enters as layers (one per page); SVG enters as lines.
 */
export function readSource(path: string, warn: (m: string) => void = () => {}): Source {
  const ext = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".svg"].includes(ext)) throw new Error(`unsupported input format "${ext}" (supported: ${INPUT_FORMATS})`);
  const buf = readFileSync(path);
  if (ext === ".png") {
    const png = PNG.sync.read(buf);
    return imageFromRGBA(png.width, png.height, png.data);
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return imageFromRGBA(j.width, j.height, j.data);
  }
  if (ext === ".webp") {
    const w = decodeWebp(buf);
    return imageFromRGBA(w.width, w.height, w.data);
  }
  if (ext === ".svg") {
    const { geometry, warnings } = parseSvg(buf.toString("utf8"));
    for (const w of warnings) warn(`${basename(path)}: ${w}`);
    return geometry;
  }
  return decodeTiffSource(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

/** A raster source file as an image (errors for separations and SVG). */
export function readImage(path: string, warn: (m: string) => void = () => {}): RawImage {
  const s = readSource(path, warn);
  const stage = sourceStage(s);
  if (stage !== "image") throw new Error(`${basename(path)} enters as ${stage}, not an image`);
  return s as RawImage;
}

/** Expand a `*` wildcard in the file-name part only (e.g. 'frames/*.png'), sorted. */
export function expandInput(pattern: string): string[] {
  const name = basename(pattern);
  if (!name.includes("*")) return [pattern];
  const dir = dirname(pattern);
  const re = new RegExp(`^${name.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => join(dir, f));
}
