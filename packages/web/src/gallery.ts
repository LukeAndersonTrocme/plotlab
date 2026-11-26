import type { Recipe } from "@plotlab/engine";
import { applyPreset, presets } from "@plotlab/steps";
import { autoCheckpoint } from "./checkpoints.ts";
import { targetLabel } from "./setup.ts";
import type { Checkpoint, ProjectStore } from "./storage/index.ts";

/**
 * The preset gallery (top bar, Presets): every preset drawn on your own picture and page.
 * Picking one saves the current recipe as a checkpoint first, then replaces the steps.
 */

/** Fits a recipe to where the current source enters the chain (App's `enter`). */
export type Fit = (r: Recipe) => { recipe: Recipe; note: string | null };

export interface GalleryItem {
  id: string;
  title: string;
  summary: string;
  /** The recipe this preset would give you: what its picture is drawn from. */
  recipe: Recipe;
  /** What else it changes besides the steps (the output), or null. */
  change: string | null;
}

/** "Switches the output to …" when a preset changes the output; null when it keeps it. */
export function presetChange(before: Recipe, after: Recipe): string | null {
  if (JSON.stringify(before.target) === JSON.stringify(after.target)) return null;
  const label = targetLabel(after.target.kind);
  return after.target.kind !== before.target.kind ? `Switches the output to ${label}` : `Changes the ${label} settings`;
}

export function galleryItems(current: Recipe, fit: Fit): GalleryItem[] {
  return presets.map((p) => {
    const recipe = fit(applyPreset(current, p.id)).recipe;
    return { id: p.id, title: p.title, summary: p.summary, recipe, change: presetChange(current, recipe) };
  });
}

/**
 * Picks a preset. The current recipe is saved as a checkpoint first (unless it already is
 * one); if that save fails, the error is thrown and nothing changes. Without storage
 * (`project` null) the preset still applies, and Back undoes it. A preset with a target
 * switches to it and keeps you there.
 */
export async function pickPreset(
  project: ProjectStore | null,
  current: Recipe,
  id: string,
  fit: Fit,
  now?: number,
): Promise<{ recipe: Recipe; saved: { checkpoint: Checkpoint; created: boolean } | null; message: string }> {
  const p = presets.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset "${id}"`);
  const saved = project ? await autoCheckpoint(project, { recipe: current, name: `Before “${p.title}”`, now }) : null;
  const { recipe, note } = fit(applyPreset(current, id));
  // "Switches the output to …" → "… and switched the output to …".
  const change = presetChange(current, recipe)?.replace(/^Switches/, "switched").replace(/^Changes/, "changed");
  const applied = `Applied “${p.title}”${change ? ` and ${change}` : ""}.`;
  const after = saved ? " Your previous settings are saved as a checkpoint." : " Checkpoints are off, so it wasn't saved first: Back undoes this.";
  return { recipe, saved, message: applied + after + (note ? `\n${note}` : "") };
}
