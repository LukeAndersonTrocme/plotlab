import { defaultParams, RECIPE_SCHEMA_VERSION, type Paper, type Recipe } from "@plotlab/engine";
import { centerline, plot, threshold } from "@plotlab/steps";

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
    paper: { widthMm: 297, heightMm: 210 },
    pens: [{ id: "pen-1", widthMm: 0.5, color: "#1a1a1a" }],
    machine: "generic",
    steps: [threshold, centerline, plot].map((s) => ({ step: s.id, version: s.version, params: defaultParams(s.params), enabled: true })),
  };
}
