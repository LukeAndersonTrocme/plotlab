import type { Checkpoint, ProjectStore } from "./storage/index.ts";

/**
 * Automatic checkpoints (the ones plotlab saves for you: before a preset, a restore, a split,
 * undoing a split, linking inks) are capped so a long session can't fill the browser's storage.
 * Saved-by-hand, named and "From bundle" checkpoints have no `auto` mark and are never pruned;
 * renaming or noting an automatic one drops the mark (you adopted it).
 */
export const MAX_AUTO_CHECKPOINTS = 30;

/** Something that still points at checkpoints: gives the ids to keep, whatever their age. */
type Keeper = (all: Checkpoint[]) => Iterable<string | undefined>;
const keepers = new Set<Keeper>();

/** Registers a live reference (Undo the split's checkpoint, ...). Returns the way to unregister. */
export function registerKeeper(k: Keeper): () => void {
  keepers.add(k);
  return () => void keepers.delete(k);
}

/**
 * Deletes the oldest automatic checkpoints beyond the cap, with their pictures. Referenced
 * ones (keepers) are skipped and don't count against the cap. Never throws: a failed prune
 * must not fail the save that triggered it.
 */
export async function pruneAuto(project: Pick<ProjectStore, "listCheckpoints" | "deleteCheckpoint">, max = MAX_AUTO_CHECKPOINTS): Promise<string[]> {
  try {
    const all = await project.listCheckpoints();
    const keep = new Set<string>();
    for (const k of keepers) for (const id of k(all)) if (id) keep.add(id);
    const old = all
      .filter((c) => c.auto && !keep.has(c.id))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .slice(max);
    await Promise.all(old.map((c) => project.deleteCheckpoint(c.id)));
    return old.map((c) => c.id);
  } catch {
    return [];
  }
}
