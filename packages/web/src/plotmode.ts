import { exportFormats, type ExportFormat, type Plot, type PlotLayer, type Position, type Target } from "@plotlab/engine";
import { timeBreakdown, type PlotEstimate, type TimeComponent } from "@plotlab/machines";

/**
 * Plot mode's rules (#66, #73): the time breakdown, pass order, one pen on its own, the
 * plot-order animation and the output buttons. Pure, so they're tested without a browser;
 * `PlotPanel.tsx` and `PassStrip` render them. Which pen is soloed and where the animation
 * is are only the view (no Back step); a new pass order is a recipe edit (`passOrder`, ADR 0011).
 */

// ---------------------------------------------------------------- time

export interface TimeRow {
  key: TimeComponent;
  label: string;
  /** How much: metres drawn or travelled, or how many lifts or changes. */
  detail: string;
  seconds: number;
}

const strokes = (l: PlotLayer) => l.paths.filter((p) => p.length > 0).length;

/** Pen lifts: one per stroke (the estimate lifts and lowers the pen once per non-empty stroke). */
export const penLifts = (plot: Plot) => plot.layers.reduce((n, l) => n + strokes(l), 0);

const count = (n: number) => n.toLocaleString("en-US");
/** Metres, with two decimals while it's short (40 mm is "0.04 m", not "0.0 m"). */
const metres = (mm: number) => `${(mm / 1000).toFixed(mm < 10_000 ? 2 : 1)} m`;

/** Where the time goes, from `estimatePlot`: drawing, travel, pen lifts, pen changes. They add up to its total. */
export function timeRows(plot: Plot, e: PlotEstimate): TimeRow[] {
  const t = timeBreakdown(e);
  const sum = (k: "drawLengthMm" | "travelLengthMm") => e.passes.reduce((n, p) => n + p[k], 0);
  return [
    { key: "draw", label: "Drawing", detail: metres(sum("drawLengthMm")), seconds: t.draw },
    { key: "travel", label: "Travel", detail: metres(sum("travelLengthMm")), seconds: t.travel },
    { key: "pen", label: "Pen lifts", detail: count(penLifts(plot)), seconds: t.pen },
    { key: "penChanges", label: "Pen changes", detail: count(e.penChanges), seconds: t.penChanges },
  ];
}

// ---------------------------------------------------------------- passes

export interface PassBox {
  id: string;
  name: string;
  color: string;
  /** Strokes in this pass. */
  lines: number;
  /** This pass's time (without pen changes); null without an estimate. */
  timeS: number | null;
}

/** The Plot-mode strip: one box per pass (pen), in pass order. */
export function passBoxes(plot: Plot, e: PlotEstimate | null): PassBox[] {
  return plot.layers.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.ink.color,
    lines: strokes(l),
    timeS: e?.passes.find((p) => p.layerId === l.id)?.timeS ?? null,
  }));
}

/** Pass `i` one place earlier (-1) or later (+1): the new `passOrder` (layer ids), or null at an end. */
export function movePass(plot: Plot, i: number, d: -1 | 1): string[] | null {
  const ids = plot.layers.map((l) => l.id);
  const j = i + d;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return ids;
}

/** Only one pen's lines (null = every pen). A pen that isn't in the plot shows them all. */
export function soloPlot(plot: Plot, solo: string | null): Plot {
  if (solo === null || !plot.layers.some((l) => l.id === solo)) return plot;
  return { ...plot, layers: plot.layers.filter((l) => l.id === solo) };
}

/** The soloed pen, if it's still in the plot; else back to every pen. */
export function fitSolo(solo: string | null, plot: Plot | null): string | null {
  return solo !== null && plot?.layers.some((l) => l.id === solo) ? solo : null;
}

// ---------------------------------------------------------------- animation

/** How long Play takes from start to end, whatever the plot's size. */
export const PLAY_MS = 12_000;
/**
 * The animation moves along the pen-down length, in pass order then stroke order. Each stroke
 * also counts this much (mm) for the pen landing, so dots and tiny strokes show up as it plays.
 */
const LANDING = 0.5;

const seg = (a: Position, b: Position) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const weight = (p: Position[]) => {
  if (p.length === 0) return 0;
  let s = LANDING;
  for (let i = 1; i < p.length; i++) s += seg(p[i - 1]!, p[i]!);
  return s;
};

/** Per layer, each stroke's weight; and the total. Worked out once per plot. */
const weights = new WeakMap<Plot, { layers: number[][]; total: number }>();
function weightsOf(plot: Plot) {
  let w = weights.get(plot);
  if (!w) {
    const layers = plot.layers.map((l) => l.paths.map(weight));
    w = { layers, total: layers.flat().reduce((a, b) => a + b, 0) };
    weights.set(plot, w);
  }
  return w;
}

/** The first `len` mm of a stroke, after its landing. */
function cutPath(p: Position[], len: number): Position[] {
  const out: Position[] = [p[0]!];
  for (let i = 1; i < p.length && len > 0; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const d = seg(a, b);
    if (d <= len) {
      out.push(b);
      len -= d;
    } else {
      const k = len / d;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      len = 0;
    }
  }
  return out;
}

export interface Frame {
  /** What's been drawn so far. Finished strokes are the plot's own arrays. */
  plot: Plot;
  /** Where the pen is, while it's still drawing. */
  head: { layerId: string; at: Position } | null;
}

/** The plot drawn up to `t` (0 = nothing yet, 1 = all of it). */
export function framePlot(plot: Plot, t: number): Frame {
  const w = weightsOf(plot);
  if (t >= 1 || w.total === 0) return { plot, head: null };
  let left = Math.max(0, t) * w.total;
  let head: Frame["head"] = null;
  const layers = plot.layers.map((l, li) => {
    const paths: Position[][] = [];
    for (let pi = 0; pi < l.paths.length && left > 0; pi++) {
      const p = l.paths[pi]!;
      const pw = w.layers[li]![pi]!;
      if (pw === 0) continue;
      if (pw <= left) {
        paths.push(p);
        left -= pw;
        head = { layerId: l.id, at: p[p.length - 1]! };
        continue;
      }
      const cut = cutPath(p, left - LANDING);
      paths.push(cut);
      head = { layerId: l.id, at: cut[cut.length - 1]! };
      left = 0;
    }
    return paths.length === l.paths.length ? l : { ...l, paths };
  });
  return { plot: { ...plot, layers }, head };
}

/** Under the scrubber: which pass the pen is on, and how far through the plot. */
export function frameLabel(plot: Plot, t: number): string {
  const w = weightsOf(plot);
  if (t >= 1 || w.total === 0) return "The whole plot";
  const at = Math.max(0, t) * w.total;
  let end = 0;
  let pass = plot.layers.length - 1;
  for (let i = 0; i < plot.layers.length; i++) {
    end += w.layers[i]!.reduce((a, b) => a + b, 0);
    if (at < end) {
      pass = i;
      break;
    }
  }
  return `Pass ${pass + 1} of ${plot.layers.length}: ${plot.layers[pass]!.name} · ${Math.round(Math.max(0, t) * 100)}%`;
}

/** The animation `dtMs` later (it never goes backwards and stops at the end). */
export function advance(t: number, dtMs: number, playMs = PLAY_MS): number {
  return Math.min(1, t + Math.max(0, dtMs) / playMs);
}

/** Play at the end starts again from the beginning; anywhere else it carries on. */
export const startPlay = (t: number) => (t >= 1 ? 0 : t);

// ---------------------------------------------------------------- output

/** The download buttons: the target's own files first, then SVG and PNG, which every target has. */
export function outputFormats(target: Target): ExportFormat[] {
  return [...new Set<ExportFormat>([...exportFormats(target), "svg", "png"])];
}

/**
 * Whether Send to plotter works, and why not. Digital targets and print prep have no plotter
 * to send to; a plotter needs lines.
 */
export function sendState(target: Target, hasLines: boolean): { ok: true } | { ok: false; reason: string } {
  switch (target.kind) {
    case "raster":
    case "vector":
      return { ok: false, reason: "This is a digital target, so there's no plotter to send it to. To plot it, choose Plotter in Page mode." };
    case "print":
      return { ok: false, reason: "Print prep makes files for printing, not for a plotter. To plot it, choose Plotter in Page mode." };
    case "plotter":
      return hasLines ? { ok: true } : { ok: false, reason: "Nothing to send yet: the recipe has no lines to plot." };
  }
}
