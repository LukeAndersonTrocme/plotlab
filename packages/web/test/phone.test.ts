import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { indexedDbLibrary, memoryLibrary, type Checkpoint, type Library, type NewSource } from "../src/storage/index.ts";
import { inspectFor, isPhoneWidth, listProjectCards, nudgeSplit, openForViewing, PHONE_MAX_PX, PHONE_QUERY, phoneWidth, projectCover, readOnlyLibrary, splitAt, viewerLibrary } from "../src/phone.ts";

describe("phone width switch", () => {
  it("is a phone under 700 px wide, the editor from 700 px", () => {
    expect(PHONE_MAX_PX).toBe(700);
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(699)).toBe(true);
    expect(isPhoneWidth(700)).toBe(false);
    expect(isPhoneWidth(1280)).toBe(false);
    expect(PHONE_QUERY).toBe("(max-width: 699.98px)");
  });

  it("follows the media query as the screen turns or resizes", () => {
    const listeners = new Set<() => void>();
    const mql = { matches: true, addEventListener: (_: "change", f: () => void) => listeners.add(f), removeEventListener: (_: "change", f: () => void) => listeners.delete(f) };
    const store = phoneWidth({ matchMedia: (q: string) => (expect(q).toBe(PHONE_QUERY), mql), innerWidth: 0, addEventListener() {}, removeEventListener() {} });
    expect(store.getSnapshot()).toBe(true);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    mql.matches = false;
    listeners.forEach((f) => f());
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(false);
    off();
    expect(listeners.size).toBe(0);
  });

  it("falls back to the window width (and resize) without matchMedia", () => {
    const listeners = new Set<() => void>();
    const win = { innerWidth: 390, addEventListener: (_: "resize", f: () => void) => listeners.add(f), removeEventListener: (_: "resize", f: () => void) => listeners.delete(f) };
    const store = phoneWidth(win);
    expect(store.getSnapshot()).toBe(true);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    win.innerWidth = 900;
    listeners.forEach((f) => f());
    expect(store.getSnapshot()).toBe(false);
    expect(calls).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe("before/after split", () => {
  const rect = { left: 10, width: 200 };
  it("is where the finger is across the picture, from 0 to 1", () => {
    expect(splitAt(110, rect)).toBe(0.5);
    expect(splitAt(10, rect)).toBe(0);
    expect(splitAt(60, rect)).toBe(0.25);
  });
  it("stays inside the picture when the finger goes past an edge", () => {
    expect(splitAt(-50, rect)).toBe(0);
    expect(splitAt(500, rect)).toBe(1);
    expect(splitAt(50, { left: 0, width: 0 })).toBe(0.5);
  });
  it("moves with the arrow keys, Home and End; other keys do nothing", () => {
    expect(nudgeSplit(0.5, "ArrowLeft")).toBeCloseTo(0.45);
    expect(nudgeSplit(0.5, "ArrowRight")).toBeCloseTo(0.55);
    expect(nudgeSplit(0.02, "ArrowLeft")).toBe(0);
    expect(nudgeSplit(0.98, "ArrowRight")).toBe(1);
    expect(nudgeSplit(0.5, "Home")).toBe(0);
    expect(nudgeSplit(0.5, "End")).toBe(1);
    expect(nudgeSplit(0.5, "a")).toBeNull();
  });
});

describe("tapping the strip", () => {
  const recipe = { steps: [{ id: "s1" }, { id: "s2" }] };
  it("shows the source, a step by its id, or the end result", () => {
    expect(inspectFor(recipe, "source")).toBe("source");
    expect(inspectFor(recipe, "s2")).toBe(1);
    expect(inspectFor(recipe, null)).toBeNull();
    expect(inspectFor(recipe, "gone")).toBeNull();
  });
});

const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const src = (name: string, n: number, type = "image/png"): NewSource => ({ name, bytes: new Uint8Array([n, n, n]), type });
const cp = (id: string, sourceHash: string, createdAt: number): Checkpoint => ({ id, sourceHash, createdAt, recipe: { id }, name: id, note: "" });

/** Every write a Library or ProjectStore offers, counted. */
function spyWrites(lib: Library) {
  const writes: string[] = [];
  const spied: Library = {
    ...lib,
    persistent: lib.persistent,
    listProjects: () => lib.listProjects(),
    openProject: async (id) => {
      const p = await lib.openProject(id);
      if (!p) return p;
      return {
        id: p.id,
        name: p.name,
        getSource: () => p.getSource(),
        getRecipe: () => p.getRecipe(),
        getView: () => p.getView(),
        getCheckpoint: (i) => p.getCheckpoint(i),
        listCheckpoints: () => p.listCheckpoints(),
        getThumbnail: (i) => p.getThumbnail(i),
        setRecipe: (s) => (writes.push("setRecipe"), p.setRecipe(s)),
        setView: (v) => (writes.push("setView"), p.setView(v)),
        putCheckpoint: (c, t) => (writes.push("putCheckpoint"), p.putCheckpoint(c, t)),
        deleteCheckpoint: (i) => (writes.push("deleteCheckpoint"), p.deleteCheckpoint(i)),
      };
    },
    createProject: (s) => (writes.push("createProject"), lib.createProject(s)),
    deleteProject: (i) => (writes.push("deleteProject"), lib.deleteProject(i)),
    getLastOpened: () => lib.getLastOpened(),
    setLastOpened: (i) => (writes.push("setLastOpened"), lib.setLastOpened(i)),
  };
  return { spied, writes };
}

const adapters: Array<[string, () => Promise<Library>]> = [
  ["memory", async () => memoryLibrary()],
  ["indexeddb", () => indexedDbLibrary({ factory: new IDBFactory() })],
];

describe.each(adapters)("the phone viewer on %s storage", (_name, make) => {
  /** Two projects: "cat" with two checkpoints (the newer one with a picture), "dog" opened last, no checkpoints. */
  async function seed() {
    const lib = await make();
    const cat = await lib.createProject(src("cat.png", 1));
    const dog = await lib.createProject(src("dog.jpg", 2, "image/jpeg"));
    const catStore = (await lib.openProject(cat.id))!;
    await catStore.setRecipe({ recipe: { v: "cat" }, savedAt: 50 });
    await catStore.putCheckpoint(cp("old", cat.id, 10), png(1));
    await catStore.putCheckpoint(cp("new", cat.id, 20), png(2));
    await (await lib.openProject(dog.id))!.setRecipe({ recipe: { v: "dog" }, savedAt: 40 });
    await lib.setLastOpened(dog.id);
    return { lib, cat, dog };
  }

  it("only offers reading: the projects it hands out have no way to write", async () => {
    const { lib, cat } = await seed();
    const ro = readOnlyLibrary(lib);
    for (const k of ["createProject", "deleteProject", "setLastOpened"]) expect(k in ro).toBe(false);
    const p = (await ro.openProject(cat.id))!;
    for (const k of ["setRecipe", "setView", "putCheckpoint", "deleteCheckpoint"]) expect(k in p).toBe(false);
    expect((await p.getRecipe())?.recipe).toEqual({ v: "cat" });
  });

  it("lists projects with the last opened first, then the most recent work, with checkpoint counts", async () => {
    const { lib, cat, dog } = await seed();
    const cards = await listProjectCards(readOnlyLibrary(lib));
    expect(cards.map((c) => [c.id, c.name, c.checkpoints])).toEqual([
      [dog.id, "dog.jpg", 0],
      [cat.id, "cat.png", 2],
    ]);
  });

  it("orders projects not opened last by their newest recipe save or checkpoint", async () => {
    const lib = await make();
    const a = await lib.createProject(src("a.png", 1));
    const b = await lib.createProject(src("b.png", 2));
    await (await lib.openProject(a.id))!.setRecipe({ recipe: {}, savedAt: 5 });
    await (await lib.openProject(b.id))!.putCheckpoint(cp("x", b.id, 9));
    expect((await listProjectCards(readOnlyLibrary(lib))).map((c) => c.name)).toEqual(["b.png", "a.png"]);
  });

  it("covers a project with its newest checkpoint picture, else the image itself", async () => {
    const { lib, cat, dog } = await seed();
    const ro = readOnlyLibrary(lib);
    expect(await projectCover((await ro.openProject(cat.id))!)).toEqual({ bytes: png(2), type: "image/png" });
    expect(await projectCover((await ro.openProject(dog.id))!)).toEqual({ bytes: new Uint8Array([2, 2, 2]), type: "image/jpeg" });
  });

  it("covers with nothing when the browser can't show the image (a TIFF) and there's no picture", async () => {
    const lib = await make();
    const t = await lib.createProject(src("scan.tif", 3, "image/tiff"));
    expect(await projectCover((await readOnlyLibrary(lib).openProject(t.id))!)).toBeNull();
  });

  it("opens a project with its image, saved recipe and checkpoints newest first", async () => {
    const { lib, cat } = await seed();
    const v = (await openForViewing(readOnlyLibrary(lib), cat.id))!;
    expect(v.project.name).toBe("cat.png");
    expect(v.source.type).toBe("image/png");
    expect(v.recipe).toEqual({ v: "cat" });
    expect(v.checkpoints.map((c) => c.id)).toEqual(["new", "old"]);
    expect(await openForViewing(readOnlyLibrary(lib), "nope")).toBeUndefined();
  });

  it("writes nothing while you look through projects and checkpoints", async () => {
    const { lib, cat, dog } = await seed();
    const { spied, writes } = spyWrites(lib);
    const ro = readOnlyLibrary(spied);
    for (const c of await listProjectCards(ro)) await projectCover((await ro.openProject(c.id))!);
    await openForViewing(ro, cat.id);
    await openForViewing(ro, dog.id);
    expect(writes).toEqual([]);
    expect(await lib.getLastOpened()).toBe(dog.id);
    expect((await (await lib.openProject(cat.id))!.listCheckpoints()).length).toBe(2);
  });

  it("shows the sample as an unsaved example when no project is stored, and stores nothing", async () => {
    const lib = await make();
    const v = await viewerLibrary(lib, async () => src("Sample (Mona Lisa)", 9, "image/jpeg"));
    expect(v.example).toBe(true);
    const cards = await listProjectCards(v.library);
    expect(cards.map((c) => c.name)).toEqual(["Sample (Mona Lisa)"]);
    expect((await openForViewing(v.library, cards[0]!.id))?.recipe).toBeUndefined();
    expect(await lib.listProjects()).toEqual([]);
  });

  it("uses the stored projects when there are any", async () => {
    const { lib } = await seed();
    let asked = false;
    const v = await viewerLibrary(lib, async () => ((asked = true), src("s", 9)));
    expect(v.example).toBe(false);
    expect(asked).toBe(false);
    expect((await listProjectCards(v.library)).length).toBe(2);
  });
});
