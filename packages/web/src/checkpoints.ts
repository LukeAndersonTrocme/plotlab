/**
 * Checkpoints (GLOSSARY): saved by hand in a project, listed for the open project or
 * across all projects, renamed, noted, deleted, and restored as one Back step. Only the automatic ones are capped (prune.ts).
 */
import { commit, type History } from "./history.ts";
import { pruneAuto } from "./prune.ts";
import type { Checkpoint, Library, ProjectId, ProjectStore, Source } from "./storage/index.ts";

let counter = 0;
/** Sortable by time, unique within a session and very likely across devices (bundle merge is by id). */
function newId(now: number): string {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${now.toString(36)}-${counter.toString(36).padStart(2, "0")}${rand}`;
}

/** A checkpoint's short date and time, e.g. "Nov 26, 01:38 PM". */
export const checkpointTime = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** What a checkpoint is called in the list: its name, or when it was saved. */
export const checkpointLabel = (cp: Checkpoint) => cp.name || checkpointTime(cp.createdAt);

export async function createCheckpoint(
  project: ProjectStore,
  input: { recipe: unknown; thumbnail?: Uint8Array; name?: string; note?: string; now?: number; auto?: boolean },
): Promise<Checkpoint> {
  const now = input.now ?? Date.now();
  const cp: Checkpoint = { id: newId(now), createdAt: now, sourceHash: project.id, recipe: input.recipe, name: input.name?.trim() ?? "", note: input.note ?? "", ...(input.auto && { auto: true as const }) };
  await project.putCheckpoint(cp, input.thumbnail);
  return cp;
}

const newestFirst = (a: Checkpoint, b: Checkpoint) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

export async function listForProject(project: Pick<ProjectStore, "listCheckpoints">): Promise<Checkpoint[]> {
  return (await project.listCheckpoints()).sort(newestFirst);
}

export interface CheckpointGroup {
  project: ProjectStore;
  checkpoints: Checkpoint[];
}

/** Checkpoints across projects: the current project first, then by most recent checkpoint. */
export async function listAllGrouped(library: Library, current: ProjectId): Promise<CheckpointGroup[]> {
  const projects = (await Promise.all((await library.listProjects()).map((p) => library.openProject(p.id)))).filter((p): p is ProjectStore => !!p);
  const groups = (await Promise.all(projects.map(async (project) => ({ project, checkpoints: await listForProject(project) })))).filter((g) => g.checkpoints.length);
  const newest = (g: CheckpointGroup) => g.checkpoints[0]!.createdAt;
  return groups.sort((a, b) => Number(b.project.id === current) - Number(a.project.id === current) || newest(b) - newest(a));
}

export async function updateCheckpoint(project: ProjectStore, id: string, patch: { name?: string; note?: string }): Promise<Checkpoint | undefined> {
  const cp = await project.getCheckpoint(id);
  if (!cp) return undefined;
  const { auto: _auto, ...rest } = cp; // renamed or noted by hand: it's yours now, no longer pruned
  const next: Checkpoint = { ...rest, ...(patch.name !== undefined && { name: patch.name.trim() }), ...(patch.note !== undefined && { note: patch.note }) };
  await project.putCheckpoint(next);
  return next;
}

export const deleteCheckpoint = (project: ProjectStore, id: string) => project.deleteCheckpoint(id);

/**
 * Adds the picture to a checkpoint saved without one. Saving doesn't wait for the picture
 * (it's drawn in the worker); a checkpoint deleted meanwhile stays deleted.
 */
export async function attachThumbnail(project: ProjectStore, id: string, thumbnail: Uint8Array): Promise<void> {
  await project.putThumbnail(id, thumbnail); // the picture only: never rewrites the checkpoint or brings back a deleted one
}

/** Same JSON content, whatever the key order (a restored recipe has been through the upgrader). */
export function sameRecipe(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );

/**
 * The checkpoint saved before something replaces the recipe (a preset, a restore), so no
 * work is lost. A recipe that's already a checkpoint isn't saved twice: that one is returned.
 */
export async function autoCheckpoint(
  project: ProjectStore,
  input: { recipe: unknown; name: string; now?: number; deferPrune?: boolean },
): Promise<{ checkpoint: Checkpoint; created: boolean }> {
  const existing = (await listForProject(project)).find((c) => sameRecipe(c.recipe, input.recipe));
  if (existing) return { checkpoint: existing, created: false };
  const { deferPrune, ...rest } = input;
  const checkpoint = await createCheckpoint(project, { ...rest, auto: true });
  if (!deferPrune) await pruneAuto(project);
  return { checkpoint, created: true };
}

type Parse<R> = (json: unknown) => { recipe: R; warnings: string[] };

/**
 * Restoring a checkpoint is one history entry: Back returns to what was there before.
 * `parse` upgrades the stored recipe (the engine's loadRecipe, ADR 0002) and may throw.
 */
export function restoreCheckpoint<R>(history: History<R>, cp: Checkpoint, parse: Parse<R>): { history: History<R>; recipe: R; warnings: string[] } {
  const { recipe, warnings } = parse(cp.recipe);
  return { history: commit(history, recipe), recipe, warnings };
}

/**
 * Restoring from the Checkpoints list: where you are now is saved first (in the current
 * project), then the checkpoint is restored as one Back step. If saving fails, nothing is
 * restored (the error is thrown).
 */
export async function restoreSafely<R>(
  library: Library,
  current: ProjectStore,
  cp: Checkpoint,
  history: History<R>,
  parse: Parse<R>,
  save: { name: string; now?: number },
): Promise<Awaited<ReturnType<typeof restoreFrom<R>>> & { saved: { checkpoint: Checkpoint; created: boolean } }> {
  // Pruning waits until the restore has worked: a failed one must not cost an old checkpoint.
  const saved = await autoCheckpoint(current, { recipe: history.present, ...save, deferPrune: true });
  try {
    const restored = await restoreFrom(library, current, cp, history, parse);
    if (saved.created) await pruneAuto(current);
    return { ...restored, saved };
  } catch (e) {
    // Nothing was restored, so the checkpoint saved for it would be a picture-less orphan.
    if (saved.created) await current.deleteCheckpoint(saved.checkpoint.id).catch(() => undefined);
    throw e;
  }
}

/**
 * Restores a checkpoint that may belong to another project: that project is opened and its
 * source returned for the caller to show. The image switch isn't itself a Back step (as
 * when opening an image); the recipe change is.
 */
export async function restoreFrom<R>(
  library: Library,
  current: ProjectStore,
  cp: Checkpoint,
  history: History<R>,
  parse: Parse<R>,
): Promise<{ project: ProjectStore; source?: Source; history: History<R>; recipe: R; warnings: string[] }> {
  const restored = restoreCheckpoint(history, cp, parse);
  if (cp.sourceHash === current.id) return { project: current, ...restored };
  const other = await library.openProject(cp.sourceHash);
  if (!other) return { project: current, ...restored, warnings: [...restored.warnings, "That checkpoint's image isn't stored any more, so it's shown on the current image."] };
  const source = await other.getSource();
  await library.setLastOpened(other.id);
  return { project: other, source, ...restored };
}
