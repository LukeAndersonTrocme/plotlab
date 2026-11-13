import { leftoverRasters } from "./layers.ts";
import { finishing, parseColor, screenAngle, sortPasses, type Finishing, type PassOrder, type PrintOptions, type Target } from "./project.ts";
import type { Image, Ink, Layers, Paper, Plot, Position, StageData } from "./types.ts";

/**
 * Digital output (ADR 0007, 0008): the end of the chain drawn onto the paper at a DPI,
 * as one coverage plate per ink. Lines come from the plot; layers that stopped before
 * lines and an image that never left the image stage are drawn too (ADR 0009). Plates
 * composite with each ink's mix mode for previews/raster files, and become one file each
 * for print prep.
 */

export interface Plate {
  ink: Ink;
  /** Position of the ink in the recipe (picks its default screen angle). */
  inkIndex: number;
  /** Names of the layers printed with this ink. */
  layers: string[];
  /** Ink coverage per paper pixel, 0..255. */
  coverage: Uint8Array;
}

export interface Rendered {
  width: number;
  height: number;
  dpi: number;
  /** In pass order (the order they are printed / composited). */
  plates: Plate[];
  /** The source image, when the chain never left the image stage: RGB bytes, painted on the paper first. */
  image: Uint8Array | null;
}

export interface RenderSettings {
  paper: Paper;
  inks: Ink[];
  inkFor(layerId: string): Ink;
  passOrder: PassOrder;
  target: Target;
}

/** Registration mark line width when drawn into raster plates. */
const MARK_WIDTH_MM = 0.25;
/** Distance of each mark's centre from the paper edge, and its radius. */
export const MARK_INSET_MM = 7;
const MARK_RADIUS_MM = 3;

export function paperPixels(paper: Paper, dpi: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round((paper.widthMm / 25.4) * dpi)), height: Math.max(1, Math.round((paper.heightMm / 25.4) * dpi)) };
}

/** Circle-and-cross marks at the middle of each paper edge. */
export function registrationMarks(paper: Paper): Position[][] {
  const { widthMm: w, heightMm: h } = paper;
  const centres: Position[] = [
    [w / 2, MARK_INSET_MM],
    [w / 2, h - MARK_INSET_MM],
    [MARK_INSET_MM, h / 2],
    [w - MARK_INSET_MM, h / 2],
  ];
  const r = MARK_RADIUS_MM, arm = r * 1.6;
  return centres.flatMap(([cx, cy]) => {
    const circle: Position[] = [];
    for (let i = 0; i <= 48; i++) circle.push([cx + r * Math.cos((i / 48) * 2 * Math.PI), cy + r * Math.sin((i / 48) * 2 * Math.PI)]);
    return [circle, [[cx - arm, cy], [cx + arm, cy]], [[cx, cy - arm], [cx, cy + arm]]] as Position[][];
  });
}

/**
 * Finishing for line output: registration marks added to every pass (each pen draws
 * them, so the passes can be lined up), and a left-right mirror.
 */
export function finishPlot(plot: Plot, fin: Finishing): Plot {
  if (!fin.mirror && !fin.registration) return plot;
  const w = plot.paper.widthMm;
  const marks = fin.registration ? registrationMarks(plot.paper) : [];
  const flip = (p: Position[]): Position[] => (fin.mirror ? p.map(([x, y]) => [w - x, y]) : p);
  return { ...plot, layers: plot.layers.map((l) => ({ ...l, paths: [...l.paths, ...marks].map(flip) })) };
}

/** Anti-aliased round-capped strokes: coverage = max(existing, stroke). */
function drawStrokes(cov: Uint8Array, W: number, H: number, pxPerMm: number, paths: Position[][], widthMm: number): void {
  const r = Math.max(0.5, (widthMm * pxPerMm) / 2);
  for (let path of paths) {
    if (path.length === 1) path = [path[0]!, path[0]!];
    for (let k = 1; k < path.length; k++) {
      const ax = path[k - 1]![0] * pxPerMm, ay = path[k - 1]![1] * pxPerMm;
      const bx = path[k]![0] * pxPerMm, by = path[k]![1] * pxPerMm;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r + 1));
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5 - ay;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - ax;
          const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
          const ex = px - t * dx, ey = py - t * dy;
          const c = r + 0.5 - Math.sqrt(ex * ex + ey * ey);
          if (c <= 0) continue;
          const v = c >= 1 ? 255 : Math.round(c * 255);
          const i = y * W + x;
          if (v > cov[i]!) cov[i] = v;
        }
      }
    }
  }
}

/** Where paper pixel (x, y) falls in a raster laid over `frame`: source pixel coords, or null outside. */
function sampler(frame: { xMm: number; yMm: number; widthMm: number; heightMm: number }, w: number, h: number, pxPerMm: number) {
  const sx = w / frame.widthMm, sy = h / frame.heightMm;
  return (x: number, y: number): [number, number] | null => {
    const u = ((x + 0.5) / pxPerMm - frame.xMm) * sx, v = ((y + 0.5) / pxPerMm - frame.yMm) * sy;
    return u >= 0 && v >= 0 && u < w && v < h ? [u, v] : null;
  };
}

/** Paper pixel range covered by a frame (clipped to the paper). */
function frameBox(frame: { xMm: number; yMm: number; widthMm: number; heightMm: number }, W: number, H: number, pxPerMm: number) {
  return {
    x0: Math.max(0, Math.floor(frame.xMm * pxPerMm)),
    x1: Math.min(W, Math.ceil((frame.xMm + frame.widthMm) * pxPerMm)),
    y0: Math.max(0, Math.floor(frame.yMm * pxPerMm)),
    y1: Math.min(H, Math.ceil((frame.yMm + frame.heightMm) * pxPerMm)),
  };
}

/** Tone is sampled bilinearly; categories (labels) by nearest pixel, density = label / count. */
function drawLayer(cov: Uint8Array, W: number, H: number, pxPerMm: number, ls: Layers, index: number): void {
  const at = sampler(ls.frame, ls.width, ls.height, pxPerMm);
  const v = ls.layers[index]!.values;
  const lw = ls.width, lh = ls.height;
  const b = frameBox(ls.frame, W, H, pxPerMm);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const p = at(x, y);
      if (!p) continue;
      let d: number;
      if (v.kind === "categories") d = v.data[Math.floor(p[1]) * lw + Math.floor(p[0])]! / v.count;
      else {
        const fx = Math.max(0, p[0] - 0.5), fy = Math.max(0, p[1] - 0.5);
        const ix = Math.min(lw - 1, Math.floor(fx)), iy = Math.min(lh - 1, Math.floor(fy));
        const jx = Math.min(lw - 1, ix + 1), jy = Math.min(lh - 1, iy + 1);
        const tx = fx - ix, ty = fy - iy;
        const t = v.data;
        d = (t[iy * lw + ix]! * (1 - tx) + t[iy * lw + jx]! * tx) * (1 - ty) + (t[jy * lw + ix]! * (1 - tx) + t[jy * lw + jx]! * tx) * ty;
      }
      const c = Math.round(Math.max(0, Math.min(1, d)) * 255);
      const i = y * W + x;
      if (c > cov[i]!) cov[i] = c;
    }
}

function drawImage(rgb: Uint8Array, W: number, H: number, pxPerMm: number, img: Image): void {
  const at = sampler(img.frame, img.width, img.height, pxPerMm);
  const c = img.channels;
  const b = frameBox(img.frame, W, H, pxPerMm);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const p = at(x, y);
      if (!p) continue;
      const s = (Math.floor(p[1]) * img.width + Math.floor(p[0])) * c;
      const o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(Math.max(0, Math.min(1, img.data[s + (c === 1 ? 0 : k)]!)) * 255);
    }
}

function flipRows(buf: Uint8Array, W: number, H: number, ch: number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W >> 1; x++) {
      const a = (y * W + x) * ch, b = (y * W + (W - 1 - x)) * ch;
      for (let k = 0; k < ch; k++) {
        const t = buf[a + k]!;
        buf[a + k] = buf[b + k]!;
        buf[b + k] = t;
      }
    }
}

/**
 * Draw the end of the chain onto the paper at `dpi`. `plot` is the line output (already
 * stroke-ordered or not; order doesn't change pixels). Finishing from the target applies.
 */
export function renderPlates(output: StageData, plot: Plot | null, s: RenderSettings, dpi: number): Rendered {
  const { width: W, height: H } = paperPixels(s.paper, dpi);
  const pxPerMm = dpi / 25.4;
  const fin = finishing(s.target);
  const { image, layers } = leftoverRasters(output);

  // Everything that puts ink down, by layer, then grouped by ink in pass order.
  type Item = { id: string; name: string; ink: Ink; draw: (cov: Uint8Array) => void };
  const items: Item[] = [];
  for (const l of plot?.layers ?? []) items.push({ id: l.id, name: l.name, ink: l.ink, draw: (cov) => drawStrokes(cov, W, H, pxPerMm, l.paths, l.ink.widthMm) });
  layers?.layers.forEach((l, i) => items.push({ id: l.id, name: l.name, ink: s.inkFor(l.id), draw: (cov) => drawLayer(cov, W, H, pxPerMm, layers, i) }));
  const sorted = sortPasses(items, s.passOrder);

  const plates: Plate[] = [];
  for (const it of sorted) {
    let p = plates.find((x) => x.ink.id === it.ink.id);
    if (!p) plates.push((p = { ink: it.ink, inkIndex: Math.max(0, s.inks.findIndex((k) => k.id === it.ink.id)), layers: [], coverage: new Uint8Array(W * H) }));
    p.layers.push(it.name);
    it.draw(p.coverage);
  }
  if (fin.registration) {
    const marks = registrationMarks(s.paper);
    for (const p of plates) drawStrokes(p.coverage, W, H, pxPerMm, marks, MARK_WIDTH_MM);
  }
  let rgb: Uint8Array | null = null;
  if (image) {
    rgb = new Uint8Array(W * H * 3).fill(255);
    drawImage(rgb, W, H, pxPerMm, image);
  }
  if (fin.mirror) {
    for (const p of plates) flipRows(p.coverage, W, H, 1);
    if (rgb) flipRows(rgb, W, H, 3);
  }
  return { width: W, height: H, dpi, plates, image: rgb };
}

/** Inks on white paper (or on the image), each mixed by its mix mode, in pass order. RGBA bytes. */
export function composite(r: Rendered, plates: Array<{ ink: Ink; coverage: Uint8Array }> = r.plates): Uint8ClampedArray {
  const n = r.width * r.height;
  const out = new Uint8ClampedArray(n * 4);
  const inks = plates.map((p) => ({ rgb: (parseColor(p.ink.color) ?? [0, 0, 0]).map((c) => c / 255), multiply: p.ink.mix === "multiply", cov: p.coverage }));
  const img = r.image;
  // Pixel by pixel, so a 600 dpi page needs no float buffer the size of the page.
  for (let i = 0; i < n; i++) {
    let cr = img ? img[i * 3]! / 255 : 1, cg = img ? img[i * 3 + 1]! / 255 : 1, cb = img ? img[i * 3 + 2]! / 255 : 1;
    for (const k of inks) {
      const c = k.cov[i]!;
      if (c === 0) continue;
      const a = c / 255;
      if (k.multiply) {
        cr *= 1 - a + a * k.rgb[0]!;
        cg *= 1 - a + a * k.rgb[1]!;
        cb *= 1 - a + a * k.rgb[2]!;
      } else {
        cr = cr * (1 - a) + k.rgb[0]! * a;
        cg = cg * (1 - a) + k.rgb[1]! * a;
        cb = cb * (1 - a) + k.rgb[2]! * a;
      }
    }
    out[i * 4] = Math.round(cr * 255);
    out[i * 4 + 1] = Math.round(cg * 255);
    out[i * 4 + 2] = Math.round(cb * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Fraction of a unit cell inside a circle of radius d at its centre: the round-dot spot function's rank. */
function dotArea(d: number): number {
  if (d <= 0.5) return Math.PI * d * d;
  if (d >= Math.SQRT1_2) return 1;
  return Math.PI * d * d - 4 * (d * d * Math.acos(0.5 / d) - 0.5 * Math.sqrt(d * d - 0.25));
}

/**
 * Round-dot halftone: a pixel is ink when its coverage beats the screen's threshold there.
 * Dot area tracks tone exactly (the threshold is the dot's area at that radius).
 * Returns 0/255 coverage.
 */
export function halftone(cov: Uint8Array, W: number, H: number, dpi: number, lpi: number, angleDeg: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const cell = dpi / lpi;
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a) / cell, sa = Math.sin(a) / cell;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = cov[i]!;
      if (c === 0) continue;
      if (c === 255) {
        out[i] = 255;
        continue;
      }
      const px = x + 0.5, py = y + 0.5;
      const u = px * ca + py * sa, v = -px * sa + py * ca;
      const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      if (c / 255 > dotArea(Math.sqrt(fu * fu + fv * fv))) out[i] = 255;
    }
  return out;
}

/** A print-prep plate's final coverage: gray as is, bitmap thresholded at 50% or halftoned. */
export function printCoverage(p: Plate, r: Rendered, opts: PrintOptions): Uint8Array {
  if (opts.mode === "gray") return p.coverage;
  if (opts.halftone) return halftone(p.coverage, r.width, r.height, r.dpi, opts.halftone.lpi, screenAngle(opts.halftone, p.ink.id, p.inkIndex));
  const out = new Uint8Array(p.coverage.length);
  for (let i = 0; i < out.length; i++) out[i] = p.coverage[i]! >= 128 ? 255 : 0;
  return out;
}
