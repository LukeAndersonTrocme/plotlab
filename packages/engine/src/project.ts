import type { Recipe } from "./recipe.ts";
import type { Geometry, Ink, Paper, Plot, Position } from "./types.ts";

/**
 * Project-level settings: output target (ADR 0007), working resolution (ADR 0005),
 * inks (ADR 0008) and passes (ADR 0011).
 */
export type Target =
  | { kind: "plotter" }
  | { kind: "vector" }
  | { kind: "raster"; dpi: number }
  | { kind: "print"; dpi: number };

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
    paths: paths?.[i] ?? l.features.features.map((f) => f.geometry.coordinates),
  }));
  const lum = (id: string) => colorLuminance(layers.find((l) => l.id === id)!.ink.color);
  const rank = (id: string) => (Array.isArray(s.passOrder) && s.passOrder.includes(id) ? s.passOrder.indexOf(id) : Infinity);
  const ordered = layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l.id) - rank(b.l.id) || lum(b.l.id) - lum(a.l.id) || a.i - b.i)
    .map((x) => x.l);
  const plot: Plot = { kind: "plot", paper: s.paper, layers: ordered, ordered: paths !== undefined };
  if (geo.rasterLayers) plot.rasterLayers = geo.rasterLayers;
  return plot;
}
