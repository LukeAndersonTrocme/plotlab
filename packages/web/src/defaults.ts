import { DEFAULT_LAYOUT, defaultParams, RECIPE_SCHEMA_VERSION, type Paper, type Recipe } from "@plotlab/engine";
import { centerline, order, threshold } from "@plotlab/steps";

export const PAPERS: Record<string, Paper> = {
  A5: { widthMm: 148, heightMm: 210 },
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
};

export function defaultRecipe(): Recipe {
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    input: "image",
    target: { kind: "plotter" },
    paper: { widthMm: 297, heightMm: 210 },
    layout: { ...DEFAULT_LAYOUT, position: [...DEFAULT_LAYOUT.position] },
    workingMmPerPx: null,
    inks: [{ id: "ink-1", name: "Black", color: "#1a1a1a", mix: "multiply", widthMm: 0.5 }],
    layerInks: {},
    passOrder: "light-to-dark",
    machine: "generic",
    steps: [threshold, centerline, order].map((s) => ({ step: s.id, version: s.version, params: defaultParams(s.params), enabled: true })),
  };
}
