import { describe, expect, it } from "vitest";
import { memoryStore } from "../src/storage/index.ts";
import { LEGACY_RECIPE_KEY, migrateLocalRecipe, openStore, storageWarning } from "../src/storage/index.ts";

function fakeLocalStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

describe("localStorage → storage migration", () => {
  it("moves a saved recipe in once, as the current recipe on the sample", async () => {
    const s = memoryStore();
    const ls = fakeLocalStorage({ [LEGACY_RECIPE_KEY]: JSON.stringify({ steps: ["old"] }) });
    expect(await migrateLocalRecipe(s, ls)).toBe(true);
    expect(await s.getCurrent()).toEqual({ recipe: { steps: ["old"] }, sourceHash: "sample" });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
    // Later work isn't overwritten by a second run.
    await s.setCurrent({ recipe: { steps: ["new"] }, sourceHash: "sample" });
    expect(await migrateLocalRecipe(s, ls)).toBe(false);
    expect(await s.getCurrent()).toEqual({ recipe: { steps: ["new"] }, sourceHash: "sample" });
  });

  it("never overwrites a recipe already in storage, and drops the old copy", async () => {
    const s = memoryStore();
    await s.setCurrent({ recipe: { steps: ["kept"] }, sourceHash: "h" });
    const ls = fakeLocalStorage({ [LEGACY_RECIPE_KEY]: JSON.stringify({ steps: ["stale"] }) });
    expect(await migrateLocalRecipe(s, ls)).toBe(false);
    expect((await s.getCurrent())?.recipe).toEqual({ steps: ["kept"] });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
  });

  it("ignores junk and a missing localStorage", async () => {
    const s = memoryStore();
    expect(await migrateLocalRecipe(s, fakeLocalStorage({ [LEGACY_RECIPE_KEY]: "{not json" }))).toBe(false);
    expect(await migrateLocalRecipe(s, undefined)).toBe(false);
    expect(await s.getCurrent()).toBeUndefined();
  });
});

describe("opening storage", () => {
  it("falls back to memory when IndexedDB is unavailable, and says so", async () => {
    const ls = fakeLocalStorage({ [LEGACY_RECIPE_KEY]: JSON.stringify({ steps: ["old"] }) });
    const { store, persistent } = await openStore({ factory: undefined, localStorage: ls });
    expect(persistent).toBe(false);
    expect(store.persistent).toBe(false);
    // The old autosave still works for the recipe (not the image) in that case.
    expect((await store.getCurrent())?.recipe).toEqual({ steps: ["old"] });
    await store.setCurrent({ recipe: { steps: ["edited"] }, sourceHash: "h" });
    expect(JSON.parse(ls.getItem(LEGACY_RECIPE_KEY)!)).toEqual({ steps: ["edited"] });
  });
});

describe("low storage warning", () => {
  it("warns past 90% of the quota or under 50 MB left, and is quiet otherwise", () => {
    expect(storageWarning({ usage: 10e6, quota: 1e9 })).toBeNull();
    expect(storageWarning({ usage: 950e6, quota: 1e9 })).toMatch(/95%/);
    expect(storageWarning({ usage: 70e6, quota: 100e6 })).toMatch(/30 MB left/);
    expect(storageWarning(undefined)).toBeNull();
    expect(storageWarning({})).toBeNull();
  });
});
