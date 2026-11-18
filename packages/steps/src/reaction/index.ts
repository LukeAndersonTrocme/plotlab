import { createRng, defineStep, luminance, seedParam, type EnumParam, type Image } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/**
 * Gray–Scott feed (F) and kill (k) rates for each pattern (Pearson 1993). The values are the
 * usual ones; only the length scale differs (see DU), which leaves the pattern types alone.
 */
export const PATTERNS = {
  spots: { label: "Spots", F: 0.0367, k: 0.0649 },
  mazes: { label: "Mazes", F: 0.029, k: 0.057 },
  holes: { label: "Holes", F: 0.039, k: 0.058 },
} as const;
export type PatternId = keyof typeof PATTERNS;

/**
 * Simulation cells from one spot or stripe to the next, measured for these presets with the
 * DU below (9.8 for spots, 10.7 for mazes and holes, by the peak of the power spectrum).
 */
export const PX_PER_FEATURE = 10;
/** Cap on the simulation grid; past it features come out larger than asked. */
export const MAX_SIM_PIXELS = 1_000_000;

/**
 * Diffusion of U and V per cell, and the time step. The textbook setup (DU 1, DV 0.5, step 1)
 * needs about 17 cells per feature; DU 0.35 shrinks that to 10, so the same paper area costs
 * a third of the cells, and the smaller DU lets the step double (DU·DT stays well under the
 * explicit-Euler limit), halving the iterations to the same settled pattern.
 */
const DU = 0.35, DV = 0.175, DT = 2;

export interface GrayScottOptions {
  /** Per-cell source lightness, 0 (dark) .. 1 (light), on the w × h simulation grid. */
  light: Float32Array;
  width: number;
  height: number;
  lightPattern: PatternId;
  darkPattern: PatternId;
  iterations: number;
  seed: number;
  progress?: (fraction: number) => void;
}

/**
 * Run Gray–Scott on a w × h grid and return V (row-major, no border). The source tone sets
 * F and k per cell by interpolating between the dark and the light pattern. Edges reflect
 * (zero flux), so there is no seam.
 *
 * CPU reference only (ADR 0006). The GPU path (WebGL/WebGPU, one fragment pass per step) is
 * follow-up work and needed before this can run live; it must match this output in tests.
 * State is stored as float32, as a shader would, and the update is plain explicit Euler.
 */
export function grayScott(o: GrayScottOptions): Float32Array {
  const { width: w, height: h } = o;
  // Ghost-cell layout: one border cell all round, refreshed each iteration.
  const W = w + 2, H = h + 2, N = W * H;
  let u = new Float32Array(N).fill(1), v = new Float32Array(N);
  let u2 = new Float32Array(N), v2 = new Float32Array(N);
  const feed = new Float32Array(N), kill = new Float32Array(N);
  const L = PATTERNS[o.lightPattern], D = PATTERNS[o.darkPattern];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, Math.max(0, o.light[y * w + x]!));
      const i = (y + 1) * W + x + 1;
      feed[i] = D.F + t * (L.F - D.F);
      kill[i] = D.k + t * (L.k - D.k);
    }

  // Seeded start: random blocks of V about half a feature wide, with a little per-cell noise.
  const rng = createRng(o.seed);
  const b = Math.max(2, PX_PER_FEATURE >> 1);
  for (let by = 0; by < h; by += b)
    for (let bx = 0; bx < w; bx += b) {
      if (rng() >= 0.25) continue;
      for (let y = by; y < Math.min(h, by + b); y++)
        for (let x = bx; x < Math.min(w, bx + b); x++) {
          const i = (y + 1) * W + x + 1;
          u[i] = 0.5;
          v[i] = 0.25;
        }
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + 1) * W + x + 1;
      v[i] = v[i]! + 0.02 * rng();
    }

  const steps = Math.max(0, Math.round(o.iterations));
  const every = Math.max(1, Math.floor(steps / 50));
  for (let it = 0; it < steps; it++) {
    step(u, v, u2, v2, feed, kill, w, h);
    [u, u2] = [u2, u];
    [v, v2] = [v2, v];
    if ((it + 1) % every === 0 && it + 1 < steps) o.progress?.((it + 1) / steps);
  }
  o.progress?.(1);

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(v.subarray((y + 1) * W + 1, (y + 1) * W + 1 + w), y * w);
  return out;
}

/** One explicit Euler step from (u, v) into (u2, v2). Kept monomorphic and allocation-free. */
function step(u: Float32Array, v: Float32Array, u2: Float32Array, v2: Float32Array, feed: Float32Array, kill: Float32Array, w: number, h: number): void {
  reflect(u, w, h);
  reflect(v, w, h);
  const W = w + 2;
  for (let y = 1; y <= h; y++) {
    const end = y * W + w + 1;
    for (let i = y * W + 1; i < end; i++) {
      const n = i - W, s = i + W;
      const uc = u[i]!, vc = v[i]!;
      const lu = 0.2 * (u[i - 1]! + u[i + 1]! + u[n]! + u[s]!) + 0.05 * (u[n - 1]! + u[n + 1]! + u[s - 1]! + u[s + 1]!) - uc;
      const lv = 0.2 * (v[i - 1]! + v[i + 1]! + v[n]! + v[s]!) + 0.05 * (v[n - 1]! + v[n + 1]! + v[s - 1]! + v[s + 1]!) - vc;
      const uvv = uc * vc * vc;
      const f = feed[i]!;
      u2[i] = uc + DT * (DU * lu - uvv + f * (1 - uc));
      v2[i] = vc + DT * (DV * lv + uvv - (f + kill[i]!) * vc);
    }
  }
}

/** Copy the outermost real cells into the border (zero-flux edges). */
function reflect(a: Float32Array, w: number, h: number): void {
  const W = w + 2;
  a.copyWithin(1, W + 1, W + 1 + w);
  a.copyWithin((h + 1) * W + 1, h * W + 1, h * W + 1 + w);
  for (let y = 0; y < h + 2; y++) {
    a[y * W] = a[y * W + 1]!;
    a[y * W + w + 1] = a[y * W + w]!;
  }
}

/** Bilinear sample of a w × h grid at continuous cell coordinates (cell centres at integers). */
function sample(a: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.min(w - 1, Math.max(0, x));
  y = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const top = a[y0 * w + x0]! + fx * (a[y0 * w + x1]! - a[y0 * w + x0]!);
  const bot = a[y1 * w + x0]! + fx * (a[y1 * w + x1]! - a[y1 * w + x0]!);
  return top + fy * (bot - top);
}

/** Resample grid a (aw × ah) onto bw × bh, both covering the same rectangle. */
function resampleGrid(a: Float32Array, aw: number, ah: number, bw: number, bh: number): Float32Array {
  const out = new Float32Array(bw * bh);
  const sx = aw / bw, sy = ah / bh;
  for (let y = 0; y < bh; y++) {
    const ay = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < bw; x++) out[y * bw + x] = sample(a, aw, ah, (x + 0.5) * sx - 0.5, ay);
  }
  return out;
}

const patternParam = (label: string, help: string, def: PatternId): EnumParam<PatternId> => ({
  type: "enum",
  label,
  help,
  options: (Object.keys(PATTERNS) as PatternId[]).map((value) => ({ value, label: PATTERNS[value].label })),
  default: def,
});

export const reaction = defineStep({
  id: "reaction",
  version: 1,
  title: "Reaction–diffusion",
  experimental: true,
  summary: "Grow a Turing pattern (Gray–Scott) whose spots and stripes follow the picture's light and dark.",
  input: "image",
  output: "image",
  cost: "on-demand",
  params: {
    light: patternParam("Light areas", "The pattern grown where the picture is lightest.", "spots"),
    dark: patternParam("Dark areas", "The pattern grown where the picture is darkest. Tones in between blend the two.", "holes"),
    scale: {
      type: "number",
      label: "Feature size",
      help: "Distance from one spot or stripe to the next, on the paper.",
      min: 2,
      max: 30,
      step: 0.5,
      default: 4,
      unit: "mm",
    },
    iterations: {
      type: "number",
      label: "Growth steps",
      help: "How long the pattern grows. More steps = more settled shapes, but slower.",
      min: 100,
      max: 10000,
      step: 100,
      default: 2000,
      unit: "",
    },
    seed: seedParam(),
  },
  help: help.reaction ?? "",
  run(img, p, ctx): Image {
    // The simulation grid is set by the feature size in mm, not by the working pixels, so a
    // proxy and the full-resolution run grow the same pattern (ADR 0005).
    let cellMm = p.scale / PX_PER_FEATURE;
    const area = (img.frame.widthMm / cellMm) * (img.frame.heightMm / cellMm);
    if (area > MAX_SIM_PIXELS) cellMm *= Math.sqrt(area / MAX_SIM_PIXELS);
    const sw = Math.max(4, Math.round(img.frame.widthMm / cellMm));
    const sh = Math.max(4, Math.round(img.frame.heightMm / cellMm));
    const light = resampleGrid(luminance(img), img.width, img.height, sw, sh);
    const v = grayScott({ light, width: sw, height: sh, lightPattern: p.light, darkPattern: p.dark, iterations: p.iterations, seed: p.seed, progress: ctx.progress });
    let lo = Infinity, hi = -Infinity;
    for (const x of v) (lo = Math.min(lo, x)), (hi = Math.max(hi, x));
    const data = resampleGrid(v, sw, sh, img.width, img.height);
    // Grey image: high V = ink (dark), stretched to the full range.
    const span = hi - lo;
    for (let i = 0; i < data.length; i++) data[i] = span > 1e-6 ? Math.min(1, Math.max(0, 1 - (data[i]! - lo) / span)) : 1;
    return { kind: "image", width: img.width, height: img.height, channels: 1, data, frame: img.frame };
  },
});
