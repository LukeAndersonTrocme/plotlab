/**
 * Checkpoints (GLOSSARY): saved by hand in a project, listed for the open project or
 * across all projects, renamed, noted, deleted, and restored as one Back step. No cap.
 */
import { commit, type History } from "./history.ts";
import type { Checkpoint, Library, ProjectId, ProjectStore, Source } from "./storage/index.ts";

let counter = 0;
/** Sortable by time, unique within a session and very likely across devices (bundle merge is by id). */
function newId(now: number): string {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${now.toString(36)}-${counter.toString(36).padStart(2, "0")}${rand}`;
}

export async function createCheckpoint(
  project: ProjectStore,
  input: { recipe: unknown; thumbnail?: Uint8Array; name?: string; note?: string; now?: number },
): Promise<Checkpoint> {
  const now = input.now ?? Date.now();
  const cp: Checkpoint = { id: newId(now), createdAt: now, sourceHash: project.id, recipe: input.recipe, name: input.name?.trim() ?? "", note: input.note ?? "" };
  await project.putCheckpoint(cp, input.thumbnail);
  return cp;
}

const newestFirst = (a: Checkpoint, b: Checkpoint) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

export async function listForProject(project: ProjectStore): Promise<Checkpoint[]> {
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
  const next = { ...cp, ...(patch.name !== undefined && { name: patch.name.trim() }), ...(patch.note !== undefined && { note: patch.note }) };
  await project.putCheckpoint(next);
  return next;
}

export const deleteCheckpoint = (project: ProjectStore, id: string) => project.deleteCheckpoint(id);

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
