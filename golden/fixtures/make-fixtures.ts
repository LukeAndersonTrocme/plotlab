// Generates the synthetic golden fixtures. Real photos/scans from Nick go in alongside
// as plain files. Run: pnpm fixtures
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { writeGrayTiff16 } from "./tiff-pages.ts";

const here = dirname(fileURLToPath(import.meta.url));

function write(name: string, w: number, h: number, shade: (x: number, y: number) => number) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, shade(x, y))));
      const i = (y * w + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  writeFileSync(join(here, name), PNG.sync.write(png));
}

// Thick strokes: a ring, a bar and a diagonal. Exercises loops, endpoints, junction-free paths.
write("shapes.png", 160, 120, (x, y) => {
  const r = Math.hypot(x - 50, y - 60);
  const ring = r > 22 && r < 32;
  const bar = x > 95 && x < 150 && y > 25 && y < 35;
  const diag = Math.abs(x - 95 - (y - 50)) < 5 && y > 50 && y < 105;
  return ring || bar || diag ? 0.1 : 0.95;
});

// Three 16-bit separations of one 90 × 60 px grid, named like a print shop would: a disc,
// a bar and a smooth ramp (to exercise 16-bit tone). Gray 0 = full ink, 65535 = paper.
{
  const w = 90, h = 60;
  const page = (name: string, ink: (x: number, y: number) => number) => ({
    name,
    width: w,
    height: h,
    data: Uint16Array.from({ length: w * h }, (_, i) => Math.round(65535 * (1 - Math.min(1, Math.max(0, ink(i % w, Math.floor(i / w))))))),
  });
  writeFileSync(
    join(here, "separations.tif"),
    writeGrayTiff16([
      page("Cyan", (x, y) => (Math.hypot(x - 30, y - 30) < 20 ? 1 : 0)),
      page("Magenta", (x, y) => (x > 40 && x < 85 && y > 10 && y < 22 ? 1 : 0)),
      page("Yellow", (x, y) => (y > 35 && y < 55 && x > 35 ? (x - 35) / 55 : 0)),
    ]),
  );
}

// A left-to-right ramp from white to black, for tone steps such as Dither.
write("gradient.png", 128, 48, (x) => 1 - x / 127);
