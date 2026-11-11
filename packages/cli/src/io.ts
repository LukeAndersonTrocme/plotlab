import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { imageFromRGBA, type Image } from "@plotlab/engine";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

/** Decode a raster source file into an engine Image. PNG and JPEG for now. */
export function readImage(path: string): Image {
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
  throw new Error(`unsupported input format "${ext}" (supported so far: .png, .jpg). TIFF/WebP/SVG are tracked as issues.`);
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
