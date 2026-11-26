import { defaultParams, retarget, withStepIds, type AnyStep, type Recipe, type RecipeStep, type TargetRequest } from "@plotlab/engine";
import { bands } from "./bands/index.ts";
import { cells } from "./cells/index.ts";
import { centerline } from "./centerline/index.ts";
import { dither } from "./dither/index.ts";
import { fill } from "./fill/index.ts";
import { levels } from "./levels/index.ts";
import { order } from "./order/index.ts";
import { pixelate } from "./pixelate/index.ts";
import { reaction } from "./reaction/index.ts";
import { stipple } from "./stipple/index.ts";
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
  /**
   * The output this preset is made for (e.g. a print-only look). It is applied with
   * `retarget`, like the Output panel, so mirror, registration and dpi carry over.
   * Presets without one keep the current target.
   */
  target?: TargetRequest;
}

/** A preset step; `chain` gives the steps their ids. */
const s = (def: AnyStep, params: Record<string, unknown> = {}): Omit<RecipeStep, "id"> => ({
  step: def.id,
  version: def.version,
  params: { ...defaultParams(def.params), ...params },
  enabled: true,
});

const chains: Array<Omit<Preset, "steps"> & { steps: Array<Omit<RecipeStep, "id">> }> = [
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
  {
    id: "vector-mosaic",
    title: "Vector mosaic",
    summary: "A grid of squares, one per cell, sized in five steps of darkness: sharp at any size.",
    steps: [s(tone), s(levels, { count: 5, smoothing: 0.5 }), s(cells, { mode: "scaled", cellMm: 4, threshold: 10, minSize: 15, maxSize: 95 }), s(order)],
  },
  {
    id: "atkinson-print",
    title: "Atkinson print",
    summary: "One ink of crisp 1-bit dots in the early-Macintosh style, for print or screen. Not plottable yet.",
    steps: [s(dither, { method: "atkinson", dotMm: 0.4 })],
    target: { kind: "print", mode: "bitmap", halftone: null },
  },
  {
    id: "turing",
    title: "Turing pattern",
    summary: "Grow spots, mazes and holes that follow the picture's tones, then trace each one with a single pen line. Experimental and slow.",
    steps: [s(reaction), s(threshold), s(centerline, { minLength: 0, smoothing: 0.1 }), s(order)],
  },
  {
    id: "stipple",
    title: "Stipple portrait",
    summary: "Evenly spread pen dots, denser where the picture is darker (experimental).",
    steps: [s(tone, { contrast: 1.5 }), s(stipple), s(order)],
  },
  {
    id: "tsp-line",
    title: "One-line stipple (TSP)",
    summary: "Stipple dots joined into a single continuous line that never lifts the pen (experimental).",
    steps: [s(tone, { contrast: 1.5 }), s(stipple, { spacing: 1.6 }), s(order, { method: "single" })],
  },
];

export const presets: Preset[] = chains.map((p) => ({ ...p, steps: withStepIds(p.steps) }));

/** A fresh copy of a preset's steps, ready to put in a recipe. */
export function presetSteps(id: string): RecipeStep[] {
  const p = presets.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset "${id}"`);
  return structuredClone(p.steps);
}

/** The recipe with a preset picked: its steps replace the chain, and its target (if any) is switched to. */
export function applyPreset(recipe: Recipe, id: string): Recipe {
  const p = presets.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset "${id}"`);
  // Every preset chain starts from an image; fit it to another source with `enterAt`.
  return { ...recipe, input: "image", steps: presetSteps(id), ...(p.target ? { target: retarget(recipe.target, p.target) } : {}) };
}
