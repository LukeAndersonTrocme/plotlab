import { lanesOf, splitWith, type Recipe, type StepRegistry } from "@plotlab/engine";
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

/** The checkpoint to undo a split with: the one saved at the split if it's still there, else the newest one that isn't split. */
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
  return cps.find(unsplit) ?? null;
}

/**
 * "Undo the split": restores the checkpoint from before the split as one Back step (the split
 * recipe, with any edits since, is saved as a checkpoint first). `remembered`: the checkpoint
 * saved at the split in this session. Without storage, the last recipe in Back's history from
 * before the split is used.
 */
export async function undoSplit(
  library: Library | null,
  project: ProjectStore | null,
  history: History<Recipe>,
  parse: Parse,
  registry: StepRegistry,
  remembered?: string,
  now?: number,
): Promise<{ recipe: Recipe; history: History<Recipe>; saved: Saved | null; message: string } | { reason: string }> {
  if (!isSplit(history.present, registry)) return { reason: "The picture isn't split, so there's no split to undo." };
  const cp = library && project ? await preSplitCheckpoint(project, parse, registry, remembered) : null;
  if (library && project && cp) {
    const r = await restoreSafely(library, project, cp, history, parse, { name: BEFORE_UNDO, now });
    const where = r.saved.created ? "The split version is saved as a checkpoint." : "The split version was already a checkpoint.";
    return { recipe: r.recipe, history: r.history, saved: r.saved, message: [`Undid the split: back to the settings from before it. ${where}`, ...r.warnings].join("\n") };
  }
  const before = [...history.past].reverse().find((r) => !isSplit(r, registry));
  if (!before) return { reason: "Couldn't find the recipe from before the split. Pick a checkpoint from before it in Checkpoints, or remove Separate CMYK." };
  return { recipe: before, history: commit(history, before), saved: null, message: "Undid the split: back to the settings from before it. Back returns to the split." };
}
