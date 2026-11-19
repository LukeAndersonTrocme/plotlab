import { indexedDbLibrary } from "./indexeddb.ts";
import { memoryLibrary } from "./memory.ts";
import type { Library, ProjectStore, SavedRecipe } from "./types.ts";

/** Where the recipe autosave lived before storage (M0–M3a), and where the fallback keeps it. */
export const LEGACY_RECIPE_KEY = "plotlab:recipe";
/** When the fallback wrote it (absent for pre-storage autosaves). */
export const LEGACY_SAVED_AT_KEY = "plotlab:recipe:savedAt";

export type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function defaultLocalStorage(): KeyValue | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // access itself can throw when storage is blocked
  }
}

function readLegacy(ls: KeyValue | undefined): SavedRecipe | undefined {
  try {
    const raw = ls?.getItem(LEGACY_RECIPE_KEY);
    if (!raw) return undefined;
    return { recipe: JSON.parse(raw), savedAt: Number(ls?.getItem(LEGACY_SAVED_AT_KEY)) || 0 };
  } catch {
    return undefined;
  }
}

function writeLegacy(ls: KeyValue | undefined, saved: SavedRecipe) {
  try {
    ls?.setItem(LEGACY_RECIPE_KEY, JSON.stringify(saved.recipe));
    ls?.setItem(LEGACY_SAVED_AT_KEY, String(saved.savedAt));
  } catch {
    /* autosave is a convenience */
  }
}

/**
 * Brings a recipe autosaved in localStorage (by a pre-storage build, or by the no-IndexedDB
 * fallback) into the open project, keeping whichever is newer. An undated one counts as
 * older than anything already stored. With `remove`, the localStorage copy is deleted once
 * it has been imported or found older; the fallback keeps it, as it's its own autosave.
 */
export async function migrateLegacyRecipe(project: ProjectStore, ls: KeyValue | undefined, opts: { remove: boolean }): Promise<"none" | "imported" | "older"> {
  const legacy = readLegacy(ls);
  if (!legacy) return "none";
  const saved = await project.getRecipe();
  const result = !saved || legacy.savedAt > saved.savedAt ? "imported" : "older";
  if (result === "imported") await project.setRecipe({ recipe: legacy.recipe, savedAt: legacy.savedAt || Date.now() });
  if (opts.remove) {
    try {
      ls?.removeItem(LEGACY_RECIPE_KEY);
      ls?.removeItem(LEGACY_SAVED_AT_KEY);
    } catch {
      /* nothing to clean up */
    }
  }
  return result;
}

/**
 * Opens the best storage this browser has (progressive enhancement, ADR 0014): IndexedDB,
 * or memory if that's missing, blocked or too slow. In memory, the recipe still autosaves
 * to localStorage (not the image). `persistent: false` means checkpoints won't survive a reload.
 */
export async function openLibrary(
  opts: { factory?: IDBFactory | undefined; localStorage?: KeyValue | undefined; timeoutMs?: number; onLost?: () => void } = {},
): Promise<{ library: Library; persistent: boolean }> {
  const ls = "localStorage" in opts ? opts.localStorage : defaultLocalStorage();
  try {
    const library = await indexedDbLibrary({ ...("factory" in opts && { factory: opts.factory }), ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }), ...(opts.onLost && { onLost: opts.onLost }) });
    return { library, persistent: true };
  } catch {
    return { library: memoryLibrary({ onSetRecipe: (s) => writeLegacy(ls, s) }), persistent: false };
  }
}

/** A short warning when browser storage is nearly full, or null. Input: navigator.storage.estimate(). */
export function storageWarning(estimate: { usage?: number; quota?: number } | undefined): string | null {
  const usage = estimate?.usage, quota = estimate?.quota;
  if (usage === undefined || !quota) return null;
  const left = quota - usage;
  if (usage / quota < 0.9 && left >= 50e6) return null;
  const pct = Math.round((usage / quota) * 100);
  return `Browser storage is ${pct}% full (${Math.max(0, Math.round(left / 1e6))} MB left). Delete checkpoints you don't need, or new ones may not save.`;
}

/** navigator.storage.estimate(), or undefined where the browser doesn't offer it. */
export async function estimateStorage(): Promise<{ usage?: number; quota?: number } | undefined> {
  try {
    return await globalThis.navigator?.storage?.estimate?.();
  } catch {
    return undefined;
  }
}
