/**
 * One storage interface for everything the app keeps (ADR 0014): sources, the current
 * recipe, and checkpoints. Adapters: IndexedDB (every browser), memory (tests, and the
 * fallback when IndexedDB is blocked), and later a connected project folder (#7, File
 * System Access API) or a desktop file system (ADR 0013).
 *
 * The shape follows the project-folder format so a folder adapter is a direct mapping:
 *   source.<ext>                  ↔ putSource / getSource (bytes + name + type)
 *   recipe.json                   ↔ setCurrent / getCurrent
 *   checkpoints/<id>.json         ↔ putCheckpoint / getCheckpoint / listCheckpoints
 *   checkpoints/<id>.png          ↔ the thumbnail, read on its own with getThumbnail
 *
 * Recipes are stored as plain JSON (`unknown`): the caller upgrades them with the engine's
 * `loadRecipe` (ADR 0002), so storage knows nothing about steps.
 * No Node- or React-only code here: the module may move to its own package later.
 */

/** SHA-256 of the source's bytes, lowercase hex. */
export type SourceHash = string;

/** The built-in sample image. It isn't stored; checkpoints on it point here. */
export const SAMPLE_SOURCE = "sample";

export interface SourceMeta {
  hash: SourceHash;
  /** File name when first added. */
  name: string;
  /** MIME type, e.g. image/png. */
  type: string;
  size: number;
  addedAt: number;
}

export interface StoredSource extends SourceMeta {
  bytes: Uint8Array;
}

/** What's open now: the recipe and the source it runs on. */
export interface Current {
  recipe: unknown;
  sourceHash: SourceHash;
}

/** A saved moment (GLOSSARY: Checkpoint). The thumbnail is stored beside it, not in it. */
export interface Checkpoint {
  /** Unique and stable; bundles merge checkpoints by id (ADR 0014). */
  id: string;
  createdAt: number;
  sourceHash: SourceHash;
  recipe: unknown;
  name: string;
  note: string;
}

export interface ProjectStore {
  /** False when nothing survives a reload (memory adapter). The UI says so. */
  readonly persistent: boolean;

  /** Stores the bytes once, keyed by their hash. Adding the same bytes again is a no-op. */
  putSource(bytes: Uint8Array, info: { name: string; type: string }): Promise<SourceMeta>;
  getSource(hash: SourceHash): Promise<StoredSource | undefined>;
  listSources(): Promise<SourceMeta[]>;
  deleteSource(hash: SourceHash): Promise<void>;

  getCurrent(): Promise<Current | undefined>;
  setCurrent(current: Current): Promise<void>;

  /** Adds or replaces a checkpoint. Without a thumbnail, any stored one is kept. */
  putCheckpoint(checkpoint: Checkpoint, thumbnail?: Uint8Array): Promise<void>;
  getCheckpoint(id: string): Promise<Checkpoint | undefined>;
  /** In no particular order; `checkpoints.ts` sorts. */
  listCheckpoints(filter?: { sourceHash?: SourceHash }): Promise<Checkpoint[]>;
  /** PNG bytes, ~160 px. */
  getThumbnail(id: string): Promise<Uint8Array | undefined>;
  deleteCheckpoint(id: string): Promise<void>;
}
