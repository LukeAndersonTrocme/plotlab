import type { Recipe } from "./recipe.ts";
import { featurePaths } from "./features.ts";
import type { Geometry, Ink, Paper, Plot, Position } from "./types.ts";

/**
 * Project-level settings: output target (ADR 0007), working resolution (ADR 0005),
 * inks (ADR 0008) and passes (ADR 0011).
 */
export type Target =
  | ({ kind: "plotter" } & Partial<Finishing>)
  | { kind: "vector" }
  | { kind: "raster"; dpi: number }
  | ({ kind: "print"; dpi: number } & PrintOptions & Partial<Finishing>);

/** Plate finishing shared by print prep and plotter output (ADR 0007). */
export interface Finishing {
  /** Flip left-right (screen/relief plates, transfer, emulsion side down). */
  mirror: boolean;
  /** Draw registration marks in the margin on every plate/pass so they line up. */
  registration: boolean;
}

/** Print prep: how each ink's plate is written. */
export interface PrintOptions {
  /** "bitmap" = 1-bit (solid ink or none); "gray" = 8-bit density. */
  mode: "bitmap" | "gray";
  /** Round-dot halftone screen for bitmap plates; null = plain threshold at 50%. */
  halftone: Halftone | null;
  /** Film negative: ink areas clear, paper black. Default is a film positive. */
  negative: boolean;
}

export interface Halftone {
  /** Screen ruling, lines per inch. */
  lpi: number;
  /** Screen angle per ink id, degrees. Inks not listed use the classic angle for their position. */
  angles: Record<string, number>;
}

export const DEFAULT_PRINT: PrintOptions = { mode: "bitmap", halftone: null, negative: false };

/** Classic CMYK-style screen angles by ink position (15, 75, 0, 45, then repeat shifted). */
export function screenAngle(h: Halftone, inkId: string, inkIndex: number): number {
  const a = h.angles[inkId];
  if (typeof a === "number") return a;
  return [15, 75, 0, 45][inkIndex % 4]! + 7.5 * Math.floor(inkIndex / 4);
}

export function finishing(target: Target): Finishing {
  if (target.kind === "plotter" || target.kind === "print") return { mirror: !!target.mirror, registration: !!target.registration };
  return { mirror: false, registration: false };
}

export type TargetKind = Target["kind"];
export const TARGET_KINDS: TargetKind[] = ["plotter", "vector", "raster", "print"];

/** Print time is a plotter concept. */
export function showsTime(target: Target): boolean {
  return target.kind === "plotter";
}

/** mm per working pixel: the override, else half the narrowest ink (line targets) or the DPI. */
export function workingMmPerPx(recipe: Pick<Recipe, "target" | "inks" | "workingMmPerPx">): number {
  if (recipe.workingMmPerPx && recipe.workingMmPerPx > 0) return recipe.workingMmPerPx;
  const t = recipe.target;
  if (t.kind === "raster" || t.kind === "print") return 25.4 / t.dpi;
  const narrowest = Math.min(...recipe.inks.map((i) => i.widthMm).filter((w) => w > 0));
  return Number.isFinite(narrowest) ? narrowest / 2 : 0.25;
}

/** The ink a layer is drawn with: `layerInks[layerId]`, else the first ink. */
export function inkFor(recipe: Pick<Recipe, "inks" | "layerInks">, layerId: string): Ink {
  const id = recipe.layerInks[layerId];
  return recipe.inks.find((i) => i.id === id) ?? recipe.inks[0]!;
}

/** Relative luminance of a #rgb / #rrggbb colour, 0 (black) .. 1 (white). Unknown → 0. */
export function colorLuminance(color: string): number {
  const rgb = parseColor(color);
  return rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0;
}

export function parseColor(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export type PassOrder = "light-to-dark" | string[];

/**
 * Pass order: an explicit order first (by layer id), then light → dark by ink luminance,
 * ties kept in their original order.
 */
export function sortPasses<T extends { id: string; ink: Ink }>(items: T[], passOrder: PassOrder): T[] {
  const rank = (id: string) => (Array.isArray(passOrder) && passOrder.includes(id) ? passOrder.indexOf(id) : Infinity);
  return items
    .map((l, i) => ({ l, i, lum: colorLuminance(l.ink.color) }))
    .sort((a, b) => rank(a.l.id) - rank(b.l.id) || b.lum - a.lum || a.i - b.i)
    .map((x) => x.l);
}

export interface PlotSettings {
  paper: Paper;
  inkFor(layerId: string): Ink;
  passOrder: PassOrder;
}

/**
 * Lines → plot passes. Without `paths` the strokes stay in traced order and the plot
 * says so (`ordered: false`). Passes run light → dark unless an explicit order is given;
 * layers missing from an explicit order follow, light → dark.
 */
export function toPlot(geo: Geometry, s: PlotSettings, paths?: Position[][][]): Plot {
  const layers = geo.layers.map((l, i) => ({
    id: l.id,
    name: l.name,
    ink: s.inkFor(l.id),
    paths: paths?.[i] ?? l.features.features.flatMap(featurePaths),
  }));
  const ordered = sortPasses(layers, s.passOrder);
  const plot: Plot = { kind: "plot", paper: s.paper, layers: ordered, ordered: paths !== undefined };
  if (geo.rasterLayers) plot.rasterLayers = geo.rasterLayers;
  return plot;
}
