import { createRng, defineStep, seedParam, type Frame, type GeometryLayer, type LineFeature, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/**
 * Weighted Voronoi stippling (Secord 2002). Dots are first scattered by seeded rejection
 * sampling, so darker tone keeps more of them. A few rounds of Lloyd relaxation then move
 * each dot to the tone-weighted centre of the area closest to it, which evens out the
 * spacing while keeping the density. The Voronoi cells are found on a density grid a third
 * of the darkest spacing across, sampled from the layer, so a low-res proxy and the full
 * run see the same grid (only the tone under it is coarser).
 *
 * Relaxation weights by tone², not tone: Lloyd's method settles where dot density goes as
 * the square root of the weight (Gersho: ρ^(d/(d+2)) in d = 2 dimensions), so weighting by
 * tone flattens contrast. With tone² the dot count per area stays proportional to tone.
 */

/** Above this the plot is impractical, and relaxation gets slow. */
export const MAX_DOTS = 60000;
/** Cap on the density grid used for relaxation. */
const MAX_CELLS = 1_500_000;

export interface StippleOptions {
  /** Distance between dots where the tone is full ink, mm. */
  spacing: number;
  /** Lloyd relaxation rounds. */
  iterations: number;
  seed: number;
  progress?: (fraction: number) => void;
}

/**
 * Mean tone over a rectangle of the paper, from a summed-area table. Exact for the
 * piecewise-constant pixels, so lines finer than a grid cell still count (no aliasing).
 */
function boxMean(tone: Float32Array, w: number, h: number, frame: Frame) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += tone[y * w + x]!;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row;
    }
  }
  // The SAT at a fractional pixel corner is bilinear within a pixel, so interpolate it.
  const S = (px: number, py: number) => {
    const x = Math.min(w, Math.max(0, px)), y = Math.min(h, Math.max(0, py));
    const x0 = Math.min(w - 1, Math.floor(x)), y0 = Math.min(h - 1, Math.floor(y)), fx = x - x0, fy = y - y0;
    const at = (i: number, j: number) => sat[j * (w + 1) + i]!;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const sx = w / frame.widthMm, sy = h / frame.heightMm;
  return (x0Mm: number, y0Mm: number, x1Mm: number, y1Mm: number): number => {
    const ax = (x0Mm - frame.xMm) * sx, bx = (x1Mm - frame.xMm) * sx, ay = (y0Mm - frame.yMm) * sy, by = (y1Mm - frame.yMm) * sy;
    const area = (bx - ax) * (by - ay);
    if (area <= 0) return 0;
    const sum = S(bx, by) - S(ax, by) - S(bx, ay) + S(ax, ay);
    return Math.min(1, Math.max(0, sum / area));
  };
}

/** FNV-1a, so each layer gets its own stable scatter from the same seed. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Dot centres in paper mm, inside `frame`. */
export function stipplePoints(tone: Float32Array, w: number, h: number, frame: Frame, o: StippleOptions): Position[] {
  const mean = boxMean(tone, w, h, frame);
  const W = frame.widthMm, H = frame.heightMm;
  const spacing = Math.max(0.05, o.spacing);

  // Density grid for counting, scattering and relaxation: the mean tone of each cell.
  const cell = Math.max(spacing / 3, Math.sqrt((W * H) / MAX_CELLS));
  const gw = Math.max(1, Math.round(W / cell)), gh = Math.max(1, Math.round(H / cell));
  const cw = W / gw, ch = H / gh;
  const cellTone = new Float32Array(gw * gh);
  /** Relaxation weight (tone²) per grid cell. */
  const dens = new Float32Array(gw * gh);
  let mass = 0, maxTone = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = frame.xMm + i * cw, y = frame.yMm + j * ch;
      const t = mean(x, y, x + cw, y + ch);
      cellTone[j * gw + i] = t;
      dens[j * gw + i] = t * t;
      mass += t;
      if (t > maxTone) maxTone = t;
    }
  }
  const n = Math.min(MAX_DOTS, Math.round((mass * cw * ch) / (spacing * spacing)));
  if (n === 0 || maxTone <= 0) {
    o.progress?.(1);
    return [];
  }

  // Rejection sampling: pick a cell, keep it with probability tone / max tone, and place
  // the dot uniformly inside it.
  const rng = createRng(o.seed);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let k = 0;
  for (let tries = 0; k < n && tries < n * 2000; tries++) {
    const u = rng() * gw, v = rng() * gh;
    const c = Math.min(gh - 1, Math.floor(v)) * gw + Math.min(gw - 1, Math.floor(u));
    if (rng() * maxTone < cellTone[c]!) { xs[k] = frame.xMm + u * cw; ys[k] = frame.yMm + v * ch; k++; }
  }
  const count = k;

  // Lloyd relaxation over the density grid. Buckets about one mean dot spacing wide.
  const bucket = Math.max(spacing, Math.sqrt((W * H) / count));
  const bw = Math.max(1, Math.ceil(W / bucket)), bh = Math.max(1, Math.ceil(H / bucket));
  const bx = (x: number) => Math.min(bw - 1, Math.max(0, Math.floor((x - frame.xMm) / bucket)));
  const by = (y: number) => Math.min(bh - 1, Math.max(0, Math.floor((y - frame.yMm) / bucket)));
  const sw = new Float64Array(count), sx = new Float64Array(count), sy = new Float64Array(count);
  const start = new Int32Array(bw * bh + 1), items = new Int32Array(count);
  for (let it = 0; it < o.iterations; it++) {
    // Bucket the dots (counting sort, so the order is fixed).
    start.fill(0);
    for (let d = 0; d < count; d++) start[by(ys[d]!) * bw + bx(xs[d]!) + 1]!++;
    for (let b = 0; b < bw * bh; b++) start[b + 1]! += start[b]!;
    const fillAt = start.slice(0, bw * bh);
    for (let d = 0; d < count; d++) items[fillAt[by(ys[d]!) * bw + bx(xs[d]!)]!++] = d;
    sw.fill(0); sx.fill(0); sy.fill(0);
    let last = -1;
    for (let j = 0; j < gh; j++) {
      const y = frame.yMm + (j + 0.5) * ch, qy = by(y);
      for (let i = 0; i < gw; i++) {
        const t = dens[j * gw + i]!;
        if (t <= 0) continue;
        const x = frame.xMm + (i + 0.5) * cw, qx = bx(x);
        // Neighbouring cells usually share a dot: start from the last one found.
        let best = last, bestD = last >= 0 ? (xs[last]! - x) ** 2 + (ys[last]! - y) ** 2 : Infinity;
        const maxR = Math.max(qx, bw - 1 - qx, qy, bh - 1 - qy);
        for (let r = 0; r <= maxR; r++) {
          if (bestD <= ((r - 1) * bucket) ** 2 && r > 1) break;
          for (let yy = qy - r; yy <= qy + r; yy++) {
            if (yy < 0 || yy >= bh) continue;
            const edge = yy === qy - r || yy === qy + r;
            for (let xx = qx - r; xx <= qx + r; xx += edge ? 1 : 2 * r || 1) {
              if (xx < 0 || xx >= bw) continue;
              const b = yy * bw + xx;
              for (let m = start[b]!; m < start[b + 1]!; m++) {
                const d = items[m]!;
                const dd = (xs[d]! - x) ** 2 + (ys[d]! - y) ** 2;
                if (dd < bestD || (dd === bestD && d < best)) { bestD = dd; best = d; }
              }
            }
          }
        }
        last = best;
        sw[best]! += t; sx[best]! += t * x; sy[best]! += t * y;
      }
    }
    for (let d = 0; d < count; d++) if (sw[d]! > 0) { xs[d] = sx[d]! / sw[d]!; ys[d] = sy[d]! / sw[d]!; }
    o.progress?.((it + 1) / o.iterations);
  }
  if (o.iterations <= 0) o.progress?.(1);

  const out: Position[] = new Array(count);
  for (let d = 0; d < count; d++) out[d] = [xs[d]!, ys[d]!];
  return out;
}

/** A pen tap ([p, p]) or a small closed circle, kept inside the frame. */
export function dotPath([x, y]: Position, shape: string, sizeMm: number, frame: Frame): Position[] {
  if (shape !== "circle") return [[x, y], [x, y]];
  const r = sizeMm / 2;
  const fit = (v: number, lo: number, len: number) => (len <= 2 * r ? lo + len / 2 : Math.min(lo + len - r, Math.max(lo + r, v)));
  const cx = fit(x, frame.xMm, frame.widthMm), cy = fit(y, frame.yMm, frame.heightMm);
  // Chords of about 0.3 mm, and never fewer than 8.
  const seg = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.3));
  const ring: Position[] = [];
  for (let j = 0; j <= seg; j++) {
    const t = ((j % seg) / seg) * 2 * Math.PI;
    ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return ring;
}

export const stipple = defineStep({
  id: "stipple",
  version: 1,
  title: "Stipple",
  experimental: true,
  summary: "Draw the tone as dots: darker areas get more dots, spread out evenly.",
  input: "layers",
  output: "geometry",
  cost: "on-demand",
  params: {
    spacing: {
      type: "number",
      label: "Darkest spacing",
      help: "Distance between dots where the ink is full. Lighter areas get fewer dots, further apart. Smaller = more dots and a longer plot.",
      min: 0.3,
      max: 10,
      step: 0.05,
      default: 1.2,
      unit: "mm",
    },
    iterations: {
      type: "number",
      label: "Even out",
      help: "Rounds of relaxation that spread the dots evenly. 0 keeps the raw random scatter (grainier).",
      min: 0,
      max: 50,
      step: 1,
      default: 10,
      unit: "",
    },
    shape: {
      type: "enum",
      label: "Dot",
      help: "A tap lowers the pen once, so the dot is the pen's width. A circle draws a small ring, for bigger dots.",
      options: [
        { value: "tap", label: "Pen tap" },
        { value: "circle", label: "Small circle" },
      ],
      default: "tap",
    },
    dotSize: {
      type: "number",
      label: "Dot size",
      help: "Diameter of each circle.",
      min: 0.2,
      max: 5,
      step: 0.05,
      default: 0.8,
      unit: "mm",
      visibleWhen: { param: "shape", equals: ["circle"] },
    },
    seed: seedParam(),
  },
  help: help.stipple ?? "",
  accepts: ["tone"],
  runLayer(layer, p, ctx, grid): GeometryLayer {
    const pts = stipplePoints(layer.values.data as Float32Array, grid.width, grid.height, grid.frame, {
      spacing: p.spacing,
      iterations: p.iterations,
      seed: (p.seed ^ hashId(layer.id)) >>> 0,
      progress: ctx.progress,
    });
    const features: LineFeature[] = pts.map((q) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: dotPath(q, p.shape, p.dotSize, grid.frame) },
      properties: {},
    }));
    return { id: layer.id, name: layer.name, features: { type: "FeatureCollection", features } };
  },
});
