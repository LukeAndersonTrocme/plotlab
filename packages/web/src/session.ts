/** Starting up and opening images, over the storage interface. No React here, so it's testable. */
import { createCheckpoint, listForProject } from "./checkpoints.ts";
import { migrateLegacyRecipe, type KeyValue, type Library, type NewSource, type ProjectStore, type SavedRecipe, type Source } from "./storage/index.ts";

/** The built-in sample's project name. It's a real project: its id is the hash of the bundled file. */
export const SAMPLE_NAME = "Sample (Mona Lisa)";
export const UNREADABLE_NAME = "Saved settings this version can't read";

/**
 * Reopens the last project (or makes the sample a project on a first visit), brings in an
 * old localStorage autosave, and reads the saved recipe. A recipe that can't be read (say,
 * from a newer build) is moved aside into a checkpoint rather than lost to the next autosave.
 */
export async function startSession<R>(o: {
  library: Library;
  persistent: boolean;
  localStorage: KeyValue | undefined;
  sample: () => Promise<NewSource>;
  parse: (json: unknown) => { recipe: R; warnings: string[] };
}): Promise<{ project: ProjectStore; source: Source; recipe?: R; warnings: string[] }> {
  const { library } = o;
  const last = await library.getLastOpened();
  let project = last ? await library.openProject(last) : undefined;
  if (!project) project = (await library.openProject((await library.createProject(await o.sample())).id))!;
  await library.setLastOpened(project.id);
  await migrateLegacyRecipe(project, o.localStorage, { remove: o.persistent });

  const warnings: string[] = [];
  let recipe: R | undefined;
  const saved = await project.getRecipe();
  if (saved) {
    try {
      const r = o.parse(saved.recipe);
      recipe = r.recipe;
      warnings.push(...r.warnings);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      await keepAside(project, saved, why);
      warnings.push(`Your saved settings couldn't be read (${why}). They're kept as a checkpoint named “${UNREADABLE_NAME}”; starting from the default.`);
    }
  }
  return { project, source: await project.getSource(), ...(recipe !== undefined && { recipe }), warnings };
}

async function keepAside(project: ProjectStore, saved: SavedRecipe, why: string) {
  const json = JSON.stringify(saved.recipe);
  if ((await listForProject(project)).some((c) => JSON.stringify(c.recipe) === json)) return;
  await createCheckpoint(project, { recipe: saved.recipe, name: UNREADABLE_NAME, note: why, now: saved.savedAt });
}

/** Opens an image as a project: a new one, or the same image's project with its last recipe. */
export async function openImage(library: Library, src: NewSource): Promise<{ project: ProjectStore; saved?: SavedRecipe }> {
  const project = (await library.openProject((await library.createProject(src)).id))!;
  await library.setLastOpened(project.id);
  const saved = await project.getRecipe();
  return { project, ...(saved && { saved }) };
}
