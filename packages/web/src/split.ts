import { lanesOf, splitWith, type Recipe, type StepRegistry } from "@plotlab/engine";
import { presets } from "@plotlab/steps";
import { autoCheckpoint, listForProject, restoreSafely } from "./checkpoints.ts";
import { commit, type History } from "./history.ts";
import type { Checkpoint, Library, ProjectStore } from "./storage/index.ts";

/**
 * Splitting the picture into CMYK (#66) and undoing it. Splitting is a normal recipe edit
 * (one Back step), with the recipe from before saved as a checkpoint first, the way a preset
 * or a restore saves one; "Undo the split" restores that checkpoint.
 */

/** The step that splits: Separate CMYK. */
export const SPLIT_STEP = "cmyk";
/** The checkpoint saved before a split. */
export const PRE_SPLIT = "Before splitting into CMYK";
/** The checkpoint saved before undoing a split, so linked edits made since aren't lost. */
export const BEFORE_UNDO = "Before undoing the split";

export const isSplit = (r: Recipe, registry: StepRegistry) => lanesOf(r, registry).split !== null;

/** Whether "Split into CMYK" works on this recipe (a picture, not split yet). */
export function canSplit(r: Recipe, registry: StepRegistry): boolean {
  return "recipe" in splitWith(r, SPLIT_STEP, registry);
}

type Saved = { checkpoint: Checkpoint; created: boolean };

/**
 * Split into CMYK, at `gap` (the "+" it was picked from) or where the chain makes its layers.
 * The current recipe is saved as a checkpoint first (unless it already is one); without
 * storage (`project` null) Back still undoes it. If saving fails, the error is thrown and
 * nothing changes.
 */
export async function splitIntoCmyk(
  project: ProjectStore | null,
  current: Recipe,
  registry: StepRegistry,
  gap?: number,
  now?: number,
): Promise<{ recipe: Recipe; id: string; saved: Saved | null; message: string } | { reason: string }> {
  const res = splitWith(current, SPLIT_STEP, registry, gap);
  if ("reason" in res) return res;
  const saved = project ? await autoCheckpoint(project, { recipe: current, name: PRE_SPLIT, now }) : null;
  const title = registry.get(SPLIT_STEP)?.title ?? "Separate CMYK";
  const what = res.replaced ? `${title} takes the place of ${res.replaced}, and the steps after it now work on all four inks` : `The steps after ${title} work on all four inks`;
  const back = saved ? "Your previous settings are saved as a checkpoint: Undo the split brings them back." : "Checkpoints are off, so they weren't saved first: Undo the split (or Back) brings them back.";
  return {
    recipe: res.recipe,
    id: res.recipe.steps[res.index]!.id,
    saved,
    message: `Split into CMYK. ${what}, linked: one set of settings for all of them. Print screen angles are on, so the inks don't all hatch the same way. ${back}`,
  };
}

type Parse = (json: unknown) => { recipe: Recipe; warnings: string[] };

/** Names of the checkpoints saved just before a split: "Split into CMYK", and picking a preset that splits. */
const SPLIT_NAMES = new Set([PRE_SPLIT, ...presets.filter((p) => p.screenAngles).map((p) => `Before “${p.title}”`)]);

/**
 * The checkpoint to undo a split with: the one saved at this split (remembered this session)
 * if it's still there, else the newest one saved just before a split, else the newest one
 * that isn't split.
 */
async function preSplitCheckpoint(project: ProjectStore, parse: Parse, registry: StepRegistry, remembered?: string): Promise<Checkpoint | null> {
  const unsplit = (cp: Checkpoint) => {
    try {
      return !isSplit(parse(cp.recipe).recipe, registry);
    } catch {
      return false;
    }
  };
  const cps = await listForProject(project);
  const own = remembered ? cps.find((c) => c.id === remembered) : undefined;
  if (own && unsplit(own)) return own;
  return cps.find((c) => SPLIT_NAMES.has(c.name) && unsplit(c)) ?? cps.find(unsplit) ?? null;
}

/**
 * What a split replaced, recorded the moment it's committed (sidebar, "+" or preset): where the
 * recipe from before lands in Back's history, that recipe, and the checkpoint saved for it.
 * Restoring or loading clears it (null), so Undo the split then goes by checkpoints.
 */
export interface SplitMark {
  /** Its index in `history.past` once the split is committed. */
  at: number;
  before: Recipe;
  checkpoint?: string;
}

/** The mark for a split about to be committed onto `history` (commit pushes `history.base`). */
export function markSplit(history: History<Recipe>, checkpoint?: string): SplitMark {
  return { at: history.past.length, before: history.base, ...(checkpoint ? { checkpoint } : {}) };
}

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * "Undo the split": back to the recipe from before the split, as one Back step. That is the
 * entry of Back's history the mark points at, when it is still there unchanged and the chain
 * has stayed split since (exactly what this split replaced); else the checkpoint saved at the split (the mark's, else the newest
 * one saved just before a split). The split recipe, with any edits since, is saved as a
 * checkpoint first.
 */
export async function undoSplit(
  library: Library | null,
  project: ProjectStore | null,
  history: History<Recipe>,
  parse: Parse,
  registry: StepRegistry,
  mark: SplitMark | null,
  now?: number,
): Promise<{ recipe: Recipe; history: History<Recipe>; saved: Saved | null; message: string } | { reason: string }> {
  if (!isSplit(history.present, registry)) return { reason: "The picture isn't split, so there's no split to undo." };
  const entry = mark ? history.past[mark.at] : undefined;
  // Trusted only while it still describes this split: the entry is unchanged, and every recipe
  // since it has stayed split (a stale mark from an earlier split, undone since, fails this).
  const staysSplit = !!mark && history.past.slice(mark.at + 1).every((r) => isSplit(r, registry));
  if (staysSplit && entry && sameJson(entry, mark!.before) && !isSplit(entry, registry)) {
    const saved = project ? await autoCheckpoint(project, { recipe: history.present, name: BEFORE_UNDO, now }) : null;
    const where = !saved ? "Back returns to the split." : saved.created ? "The split version is saved as a checkpoint." : "The split version was already a checkpoint.";
    return { recipe: entry, history: commit(history, entry), saved, message: `Undid the split: back to the settings from before it. ${where}` };
  }
  const cp = library && project ? await preSplitCheckpoint(project, parse, registry, staysSplit ? mark?.checkpoint : undefined) : null;
  if (library && project && cp) {
    const r = await restoreSafely(library, project, cp, history, parse, { name: BEFORE_UNDO, now });
    const where = r.saved.created ? "The split version is saved as a checkpoint." : "The split version was already a checkpoint.";
    return { recipe: r.recipe, history: r.history, saved: r.saved, message: [`Undid the split: back to the settings from before it. ${where}`, ...r.warnings].join("\n") };
  }
  return { reason: "Couldn't find the recipe from before the split. Pick a checkpoint from before it in Checkpoints, or remove Separate CMYK." };
}
