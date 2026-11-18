/**
 * Checkpoints (GLOSSARY): saved by hand, listed per source or all grouped by source,
 * renamed, noted, deleted, and restored as one Back step. No cap on how many.
 */
import { commit, type History } from "./history.ts";
import { SAMPLE_SOURCE, type Checkpoint, type ProjectStore, type SourceHash } from "./storage/index.ts";

let counter = 0;
/** Sortable by time, unique within a session and very likely across devices (bundle merge is by id). */
function newId(now: number): string {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${now.toString(36)}-${counter.toString(36).padStart(2, "0")}${rand}`;
}

export async function createCheckpoint(
  store: ProjectStore,
  input: { recipe: unknown; sourceHash: SourceHash; thumbnail?: Uint8Array; name?: string; note?: string; now?: number },
): Promise<Checkpoint> {
  const now = input.now ?? Date.now();
  const cp: Checkpoint = { id: newId(now), createdAt: now, sourceHash: input.sourceHash, recipe: input.recipe, name: input.name?.trim() ?? "", note: input.note ?? "" };
  await store.putCheckpoint(cp, input.thumbnail);
  return cp;
}

const newestFirst = (a: Checkpoint, b: Checkpoint) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

export async function listForSource(store: ProjectStore, sourceHash: SourceHash): Promise<Checkpoint[]> {
  return (await store.listCheckpoints({ sourceHash })).sort(newestFirst);
}

export interface CheckpointGroup {
  sourceHash: SourceHash;
  /** The source's file name, or a stand-in. */
  name: string;
  /** False when the image is no longer stored (restoring keeps the current image). */
  available: boolean;
  checkpoints: Checkpoint[];
}

export const SAMPLE_NAME = "Sample (Mona Lisa)";

/** Every checkpoint, grouped by source: the current source first, then by most recent checkpoint. */
export async function listAllGrouped(store: ProjectStore, currentSource: SourceHash): Promise<CheckpointGroup[]> {
  const [all, sources] = await Promise.all([store.listCheckpoints(), store.listSources()]);
  const names = new Map(sources.map((s) => [s.hash, s.name]));
  const groups = new Map<SourceHash, CheckpointGroup>();
  for (const cp of all.sort(newestFirst)) {
    let g = groups.get(cp.sourceHash);
    if (!g) {
      const sample = cp.sourceHash === SAMPLE_SOURCE;
      const name = sample ? SAMPLE_NAME : names.get(cp.sourceHash);
      g = { sourceHash: cp.sourceHash, name: name ?? "Missing image", available: sample || name !== undefined, checkpoints: [] };
      groups.set(cp.sourceHash, g);
    }
    g.checkpoints.push(cp);
  }
  const list = [...groups.values()];
  const i = list.findIndex((g) => g.sourceHash === currentSource);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

export async function updateCheckpoint(store: ProjectStore, id: string, patch: { name?: string; note?: string }): Promise<Checkpoint | undefined> {
  const cp = await store.getCheckpoint(id);
  if (!cp) return undefined;
  const next = { ...cp, ...(patch.name !== undefined && { name: patch.name.trim() }), ...(patch.note !== undefined && { note: patch.note }) };
  await store.putCheckpoint(next);
  return next;
}

export const deleteCheckpoint = (store: ProjectStore, id: string) => store.deleteCheckpoint(id);

/**
 * Restoring a checkpoint is one history entry: Back returns to what was there before.
 * `parse` upgrades the stored recipe (the engine's loadRecipe, ADR 0002).
 */
export function restoreCheckpoint<R>(history: History<R>, cp: Checkpoint, parse: (json: unknown) => { recipe: R; warnings: string[] }): { history: History<R>; recipe: R; warnings: string[] } {
  const { recipe, warnings } = parse(cp.recipe);
  return { history: commit(history, recipe), recipe, warnings };
}
