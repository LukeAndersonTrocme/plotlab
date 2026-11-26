import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { indexedDbLibrary, LEGACY_RECIPE_KEY, LEGACY_SAVED_AT_KEY, memoryLibrary, migrateLegacyRecipe, openLibrary, sha256Hex, storageWarning, type Library } from "../src/storage/index.ts";
import { openImage, readView, saveView, startSession } from "../src/session.ts";
import { fromViewBlock, initialView, pin } from "../src/view.ts";
import { dragSplit, makeCompare, setLayout } from "../src/compare.ts";
import { listForProject } from "../src/checkpoints.ts";

function fakeLocalStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}
const legacy = (recipe: unknown, savedAt?: number) =>
  fakeLocalStorage({ [LEGACY_RECIPE_KEY]: JSON.stringify(recipe), ...(savedAt !== undefined && { [LEGACY_SAVED_AT_KEY]: String(savedAt) }) });

const SAMPLE = { bytes: new Uint8Array([0xff, 0xd8, 1]), name: "Sample (Mona Lisa)", type: "image/jpeg" };
const sample = async () => ({ ...SAMPLE, bytes: SAMPLE.bytes.slice() });
const parse = (r: unknown) => {
  if ((r as { bad?: boolean }).bad) throw new Error("recipe schemaVersion 9 is newer than this build supports");
  return { recipe: r, warnings: [] as string[] };
};
const start = (library: Library, ls?: ReturnType<typeof fakeLocalStorage>, persistent = true) => startSession({ library, persistent, localStorage: ls, sample, parse });

describe("starting a session", () => {
  it("first visit: the sample is a real project, its id the hash of the sample's bytes", async () => {
    const lib = memoryLibrary();
    const s = await start(lib);
    expect(s.project.id).toBe(await sha256Hex(SAMPLE.bytes));
    expect(s.project.name).toBe("Sample (Mona Lisa)");
    expect([...s.source.bytes]).toEqual([...SAMPLE.bytes]);
    expect(s.recipe).toBeUndefined();
    expect(await lib.getLastOpened()).toBe(s.project.id);
  });

  it("reopens the last project with its recipe", async () => {
    const lib = memoryLibrary();
    const { project } = await openImage(lib, { bytes: new Uint8Array([7]), name: "cat.png", type: "image/png" });
    await project.setRecipe({ recipe: { n: 4 }, savedAt: 1 });
    const s = await start(lib);
    expect(s.project.name).toBe("cat.png");
    expect(s.recipe).toEqual({ n: 4 });
  });

  it("a saved recipe it can't read is kept as a checkpoint, not overwritten, and the user is told", async () => {
    const lib = memoryLibrary();
    const first = await start(lib);
    await first.project.setRecipe({ recipe: { bad: true }, savedAt: 3 });
    const s = await start(lib);
    expect(s.recipe).toBeUndefined();
    expect(s.warnings.join()).toMatch(/couldn't be read.*checkpoint/i);
    const kept = await listForProject(s.project);
    expect(kept.map((c) => c.recipe)).toEqual([{ bad: true }]);
    expect(kept[0]!.name).toMatch(/can't read/);
    // Starting again doesn't make a second copy.
    await start(lib);
    expect(await listForProject(s.project)).toHaveLength(1);
  });
});

describe("opening an image", () => {
  it("makes a new project, or reopens the same image's project with its last recipe", async () => {
    const lib = memoryLibrary();
    const img = () => ({ bytes: new Uint8Array([1, 2]), name: "a.png", type: "image/png" });
    const first = await openImage(lib, img());
    expect(first.saved).toBeUndefined();
    await first.project.setRecipe({ recipe: { n: 2 }, savedAt: 9 });
    const again = await openImage(lib, img());
    expect(again.project.id).toBe(first.project.id);
    expect(again.saved?.recipe).toEqual({ n: 2 });
    expect(await lib.getLastOpened()).toBe(first.project.id);
  });
});

describe("localStorage → storage migration", () => {
  it("imports the old autosave once into the open project", async () => {
    const lib = memoryLibrary();
    const ls = legacy({ steps: ["old"] });
    const s = await start(lib, ls);
    expect(s.recipe).toEqual({ steps: ["old"] });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
    // Later work isn't overwritten: the key is gone.
    await s.project.setRecipe({ recipe: { steps: ["new"] }, savedAt: Date.now() });
    expect((await start(lib, ls)).recipe).toEqual({ steps: ["new"] });
  });

  it("keeps whichever is newer: a fallback autosave newer than storage wins", async () => {
    const lib = memoryLibrary();
    const s = await start(lib);
    await s.project.setRecipe({ recipe: { v: "idb, older" }, savedAt: 10 });
    const ls = legacy({ v: "fallback, newer" }, 20);
    expect(await migrateLegacyRecipe(s.project, ls, { remove: true })).toBe("imported");
    expect(await s.project.getRecipe()).toEqual({ recipe: { v: "fallback, newer" }, savedAt: 20 });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
  });

  it("an older (or undated) autosave doesn't replace storage and is dropped", async () => {
    const lib = memoryLibrary();
    const s = await start(lib);
    await s.project.setRecipe({ recipe: { v: "idb" }, savedAt: 30 });
    const older = legacy({ v: "old" }, 20);
    expect(await migrateLegacyRecipe(s.project, older, { remove: true })).toBe("older");
    const undated = legacy({ v: "pre-storage" });
    expect(await migrateLegacyRecipe(s.project, undated, { remove: true })).toBe("older");
    expect((await s.project.getRecipe())?.recipe).toEqual({ v: "idb" });
    expect(older.has(LEGACY_RECIPE_KEY) || undated.has(LEGACY_RECIPE_KEY)).toBe(false);
  });

  it("ignores junk and a missing localStorage", async () => {
    const s = await start(memoryLibrary());
    expect(await migrateLegacyRecipe(s.project, fakeLocalStorage({ [LEGACY_RECIPE_KEY]: "{not json" }), { remove: true })).toBe("none");
    expect(await migrateLegacyRecipe(s.project, undefined, { remove: true })).toBe("none");
    expect(await s.project.getRecipe()).toBeUndefined();
  });

  it("IndexedDB path: imports into IndexedDB; after a version-bump fallback, the newer fallback recipe wins", async () => {
    const factory = new IDBFactory();
    const ls = legacy({ v: "pre-storage" });
    const opened = await openLibrary({ factory, localStorage: ls });
    expect(opened.persistent).toBe(true);
    const s1 = await startSession({ ...opened, localStorage: ls, sample, parse });
    expect(s1.recipe).toEqual({ v: "pre-storage" });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
    await s1.project.setRecipe({ recipe: { v: "idb" }, savedAt: 100 });

    // An old build hits a VersionError, falls back, and autosaves to localStorage later.
    const fallback = await openLibrary({ factory: undefined, localStorage: ls });
    expect(fallback.persistent).toBe(false);
    const sf = await startSession({ ...fallback, localStorage: ls, sample, parse });
    await sf.project.setRecipe({ recipe: { v: "fallback" }, savedAt: 200 });
    expect(ls.getItem(LEGACY_SAVED_AT_KEY)).toBe("200");

    const again = await openLibrary({ factory, localStorage: ls });
    const s2 = await startSession({ ...again, localStorage: ls, sample, parse });
    expect(s2.recipe).toEqual({ v: "fallback" });
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(false);
  });
});

describe("opening storage", () => {
  it("falls back to memory when IndexedDB is unavailable; the recipe still autosaves to localStorage", async () => {
    const ls = legacy({ steps: ["old"] }, 5);
    const opened = await openLibrary({ factory: undefined, localStorage: ls });
    expect(opened.persistent).toBe(false);
    expect(opened.library.persistent).toBe(false);
    const s = await startSession({ ...opened, localStorage: ls, sample, parse });
    expect(s.recipe).toEqual({ steps: ["old"] });
    // The fallback's autosave is the legacy key itself, so it isn't removed.
    expect(ls.has(LEGACY_RECIPE_KEY)).toBe(true);
    await s.project.setRecipe({ recipe: { steps: ["edited"] }, savedAt: 6 });
    expect(JSON.parse(ls.getItem(LEGACY_RECIPE_KEY)!)).toEqual({ steps: ["edited"] });
  });

  it("falls back to memory when opening IndexedDB hangs", async () => {
    const factory = { open: () => ({}) } as unknown as IDBFactory;
    const t = Date.now();
    const opened = await openLibrary({ factory, localStorage: undefined, timeoutMs: 30 });
    expect(opened.persistent).toBe(false);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("uses IndexedDB when it works", async () => {
    const opened = await openLibrary({ factory: new IDBFactory(), localStorage: undefined });
    expect(opened.persistent).toBe(true);
    expect(await indexedDbLibrary({ factory: new IDBFactory() })).toBeDefined();
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

describe("the view block: pinned steps come back when the project is reopened", () => {
  const chain = { steps: [{ id: "threshold" }, { id: "centerline" }, { id: "order" }] };
  const libraries: [string, () => { first: () => Promise<Library>; again: () => Promise<Library> }][] = [
    ["memory", () => { const lib = memoryLibrary(); return { first: async () => lib, again: async () => lib }; }],
    ["fake IndexedDB", () => { const factory = new IDBFactory(); return { first: () => indexedDbLibrary({ factory }), again: () => indexedDbLibrary({ factory }) }; }],
  ];

  it.each(libraries)("%s library", async (_name, make) => {
    const { first, again } = make();
    const s1 = await start(await first());
    const pinned = pin(pin(initialView, "order"), "threshold");
    const kept = await readView(s1.project);
    expect(kept).toBeUndefined();
    await saveView(s1.project, pinned, kept);

    const s2 = await start(await again());
    expect(s2.project.id).toBe(s1.project.id);
    expect(fromViewBlock(initialView, await readView(s2.project), chain).pins).toEqual(["order", "threshold"]);
    // Saving the view wrote no recipe and made no checkpoint.
    expect(await s2.project.getRecipe()).toBeUndefined();
    expect(await listForProject(s2.project)).toEqual([]);
  });

  it.each(libraries)("%s library: the comparison comes back too, strips, layout and dividers", async (_name, make) => {
    const { first, again } = make();
    const s1 = await start(await first());
    const compare = dragSplit(setLayout(makeCompare(["source", "threshold", "order"]), "rows"), 1, 0.9);
    await saveView(s1.project, { ...initialView, compare }, await readView(s1.project));

    const s2 = await start(await again());
    expect(fromViewBlock(initialView, await readView(s2.project), chain).compare).toEqual(compare);
    expect(await s2.project.getRecipe()).toBeUndefined();
    expect(await listForProject(s2.project)).toEqual([]);
    // Turning it off is saved as well.
    await saveView(s2.project, initialView, await readView(s2.project));
    const s3 = await start(await again());
    expect(fromViewBlock({ ...initialView, compare }, await readView(s3.project), chain).compare).toBeNull();
  });

  it("each image keeps its own pins", async () => {
    const lib = memoryLibrary();
    const a = await openImage(lib, { bytes: new Uint8Array([1]), name: "a.png", type: "image/png" });
    const b = await openImage(lib, { bytes: new Uint8Array([2]), name: "b.png", type: "image/png" });
    await saveView(a.project, pin(initialView, "order"), undefined);
    expect(fromViewBlock(initialView, await readView(b.project), chain).pins).toEqual([]);
    expect(fromViewBlock(initialView, await readView(a.project), chain).pins).toEqual(["order"]);
  });

  it("a view block that can't be read (storage failing) is no view block, not an error", async () => {
    const lib = memoryLibrary();
    const { project } = await openImage(lib, { bytes: new Uint8Array([3]), name: "c.png", type: "image/png" });
    const failing = { ...project, getView: () => Promise.reject(new Error("disk on fire")) };
    expect(await readView(failing)).toBeUndefined();
  });
});
