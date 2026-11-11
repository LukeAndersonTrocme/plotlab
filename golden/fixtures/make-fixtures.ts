// Generates the synthetic golden fixtures. Real photos/scans from Nick go in alongside
// as plain files. Run: pnpm fixtures
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

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
