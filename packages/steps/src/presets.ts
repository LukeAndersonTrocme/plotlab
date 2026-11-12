import { defaultParams, type AnyStep, type RecipeStep } from "@plotlab/engine";
import { bands } from "./bands/index.ts";
import { centerline } from "./centerline/index.ts";
import { fill } from "./fill/index.ts";
import { levels } from "./levels/index.ts";
import { order } from "./order/index.ts";
import { pixelate } from "./pixelate/index.ts";
import { threshold } from "./threshold/index.ts";
import { tone } from "./tone/index.ts";

/**
 * Presets are recipe fragments: a starting chain of steps (ADR 0012). Each one is proven by
 * a golden case (`"preset": "<id>"` in golden/cases), so its output is reviewed.
 */
export interface Preset {
  id: string;
  title: string;
  summary: string;
  steps: RecipeStep[];
}

const s = (def: AnyStep, params: Record<string, unknown> = {}): RecipeStep => ({
  step: def.id,
  version: def.version,
  params: { ...defaultParams(def.params), ...params },
  enabled: true,
});

export const presets: Preset[] = [
  {
    id: "centerline",
    title: "Single-line trace",
    summary: "Black and white, then one pen line down the middle of each shape.",
    steps: [s(threshold), s(centerline), s(order)],
  },
  {
    id: "topo-hatch",
    title: "Topographic hatching",
    summary: "Six bands from light to dark, each hatched in a new direction, building up like cross-hatching.",
    steps: [
      s(tone),
      s(levels, { count: 6, smoothing: 0.8 }),
      s(bands, { simplify: 0.2 }),
      s(fill, { mapping: "cycle", cumulative: true, minSpacing: 0.7, maxSpacing: 2.4 }),
      s(order),
    ],
  },
  {
    id: "topo-dots",
    title: "Dotted bands",
    summary: "Five bands filled with dots that grow with darkness, for screen print or letterpress.",
    steps: [s(tone), s(levels, { count: 5, smoothing: 0.8 }), s(bands), s(fill, { kind: "dots", minSpacing: 1.6, maxSpacing: 3, dotSize: 1.5 }), s(order)],
  },
  {
    id: "contours",
    title: "Contour map",
    summary: "Only the borders between eight levels, like the lines on a topographic map.",
    steps: [s(tone), s(levels, { count: 8, smoothing: 1.2 }), s(bands, { mode: "contours", simplify: 0.3 }), s(order)],
  },
  {
    id: "pixel-bands",
    title: "Pixel hatching",
    summary: "Big square cells in five tones, each hatched in its own direction.",
    steps: [
      s(tone),
      s(pixelate, { cellMm: 6 }),
      s(levels, { count: 5, smoothing: 0 }),
      s(bands, { simplify: 0 }),
      s(fill, { mapping: "cycle", minSpacing: 0.7, maxSpacing: 2.2 }),
      s(order),
    ],
  },
];

/** A fresh copy of a preset's steps, ready to put in a recipe. */
export function presetSteps(id: string): RecipeStep[] {
  const p = presets.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset "${id}"`);
  return structuredClone(p.steps);
}
