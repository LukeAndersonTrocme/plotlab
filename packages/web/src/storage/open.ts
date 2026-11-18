import { indexedDbStore } from "./indexeddb.ts";
import { memoryStore } from "./memory.ts";
import { SAMPLE_SOURCE, type ProjectStore } from "./types.ts";

/** Where the recipe autosave lived before storage (M0–M3a). */
export const LEGACY_RECIPE_KEY = "plotlab:recipe";

export type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultLocalStorage(): KeyValue | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // access itself can throw when storage is blocked
  }
}

function readLegacy(ls: KeyValue | undefined): unknown {
  try {
    const raw = ls?.getItem(LEGACY_RECIPE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Moves a recipe autosaved in localStorage into storage, once: it becomes the current
 * recipe (on the sample image, the only source that survived a reload before), unless
 * storage already has one. The old copy is removed either way, so this never runs twice.
 * Returns true if it moved a recipe.
 */
export async function migrateLocalRecipe(store: ProjectStore, ls: KeyValue | undefined): Promise<boolean> {
  const recipe = readLegacy(ls);
  let moved = false;
  if (recipe !== undefined && !(await store.getCurrent())) {
    await store.setCurrent({ recipe, sourceHash: SAMPLE_SOURCE });
    moved = true;
  }
  try {
    ls?.removeItem(LEGACY_RECIPE_KEY);
  } catch {
    /* nothing to clean up */
  }
  return moved;
}

/**
 * The fallback when IndexedDB is blocked: memory for everything, but the current recipe
 * also goes to localStorage as before, so a reload keeps at least the settings.
 */
function withLocalRecipe(store: ProjectStore, ls: KeyValue | undefined): ProjectStore {
  return {
    ...store,
    async getCurrent() {
      const c = await store.getCurrent();
      if (c) return c;
      const recipe = readLegacy(ls);
      return recipe === undefined ? undefined : { recipe, sourceHash: SAMPLE_SOURCE };
    },
    async setCurrent(c) {
      await store.setCurrent(c);
      try {
        ls?.setItem(LEGACY_RECIPE_KEY, JSON.stringify(c.recipe));
      } catch {
        /* autosave is a convenience */
      }
    },
  };
}

/**
 * Opens the best storage this browser has (progressive enhancement, ADR 0014): IndexedDB,
 * or memory if that's blocked. `persistent: false` means checkpoints won't survive a reload.
 */
export async function openStore(
  opts: { factory?: IDBFactory | undefined; localStorage?: KeyValue | undefined } = {},
): Promise<{ store: ProjectStore; persistent: boolean }> {
  const ls = "localStorage" in opts ? opts.localStorage : defaultLocalStorage();
  try {
    const store = await indexedDbStore("factory" in opts ? { factory: opts.factory } : {});
    await migrateLocalRecipe(store, ls);
    return { store, persistent: true };
  } catch {
    return { store: withLocalRecipe(memoryStore(), ls), persistent: false };
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
