/**
 * Storage (ADR 0014). The unit is a **project** (GLOSSARY): one source with its current
 * recipe and its checkpoints, the same thing a project folder or a bundle holds.
 *
 *   Library        all projects: list, create (from a source), open, delete
 *   ProjectStore   one project:  source.<ext>, recipe.json, checkpoints/<id>.json + .png
 *
 * Adapters: IndexedDB (every browser) and memory (tests; the fallback when IndexedDB is
 * blocked). A connected folder (#7) and a desktop file system (ADR 0013) come later and
 * implement the same two interfaces; `test/storage.test.ts` says which call maps to which
 * file. Recipes are stored as plain JSON: the caller upgrades them with the engine's
 * `loadRecipe` (ADR 0002). No Node- or React-only code here, so this can become a package.
 */

/** SHA-256 of a project's source bytes, lowercase hex. The same image is the same project. */
export type ProjectId = string;

export interface ProjectInfo {
  id: ProjectId;
  /** The source's file name when first opened (a folder adapter: the folder's name). */
  name: string;
}

/** The source image as stored: `source.<ext>`, the type giving the extension. */
export interface Source {
  bytes: Uint8Array;
  /** MIME type, e.g. image/png. */
  type: string;
}

export interface NewSource extends Source {
  name: string;
}

/** recipe.json, with when it was written (a folder: the file's modified time). */
export interface SavedRecipe {
  recipe: unknown;
  savedAt: number;
}

/** A saved moment (GLOSSARY: Checkpoint). The thumbnail is stored beside it, not in it. */
export interface Checkpoint {
  /** Unique and stable; bundles merge checkpoints by id (ADR 0014). */
  id: string;
  createdAt: number;
  /** The project's id, so a checkpoint file on its own still says which image it's for. */
  sourceHash: ProjectId;
  recipe: unknown;
  name: string;
  note: string;
}

export interface ProjectStore {
  readonly id: ProjectId;
  readonly name: string;
  getSource(): Promise<Source>;
  getRecipe(): Promise<SavedRecipe | undefined>;
  setRecipe(saved: SavedRecipe): Promise<void>;
  /** Adds or replaces a checkpoint. Without a thumbnail, any stored one is kept. */
  putCheckpoint(checkpoint: Checkpoint, thumbnail?: Uint8Array): Promise<void>;
  getCheckpoint(id: string): Promise<Checkpoint | undefined>;
  /** In no particular order; `checkpoints.ts` sorts. */
  listCheckpoints(): Promise<Checkpoint[]>;
  /** PNG bytes, ~160 px. */
  getThumbnail(id: string): Promise<Uint8Array | undefined>;
  deleteCheckpoint(id: string): Promise<void>;
}

export interface Library {
  /** False when nothing survives a reload (memory). The UI says so. */
  readonly persistent: boolean;
  listProjects(): Promise<ProjectInfo[]>;
  /** The project for this source: new, or the existing one if these bytes were opened before. */
  createProject(source: NewSource): Promise<ProjectInfo>;
  openProject(id: ProjectId): Promise<ProjectStore | undefined>;
  /** Removes the project with its source, recipe and checkpoints. */
  deleteProject(id: ProjectId): Promise<void>;
  /** Which project to reopen after a reload (a browser preference, not part of the format). */
  getLastOpened(): Promise<ProjectId | undefined>;
  setLastOpened(id: ProjectId): Promise<void>;
}
