import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { decodeTiff, imageFromRGBA, type RawImage } from "@plotlab/engine";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

/** Decode a raster source file into an engine Image: PNG, JPEG, TIFF (8/16-bit; first page). */
export function readImage(path: string, warn: (m: string) => void = () => {}): RawImage {
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  if (ext === ".png") {
    const png = PNG.sync.read(buf);
    return imageFromRGBA(png.width, png.height, png.data);
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return imageFromRGBA(j.width, j.height, j.data);
  }
  if (ext === ".tif" || ext === ".tiff") {
    const pages = decodeTiff(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    if (pages.length > 1) warn(`${basename(path)} has ${pages.length} pages; using the first (separations as layers are tracked in an issue)`);
    return pages[0]!;
  }
  throw new Error(`unsupported input format "${ext}" (supported: .png, .jpg, .tif). WebP works in the web app; SVG input is tracked as an issue.`);
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
