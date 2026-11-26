import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { indexedDbLibrary, memoryLibrary, sha256Hex, type Checkpoint, type Library } from "../src/storage/index.ts";

const bytes = (...b: number[]) => new Uint8Array(b);
const src = (name: string, ...b: number[]) => ({ bytes: bytes(...b), name, type: "image/png" });
const cp = (id: string, sourceHash: string, createdAt = 1): Checkpoint => ({ id, sourceHash, createdAt, recipe: { id }, name: "", note: "" });

/**
 * The storage contract (ADR 0014). Every adapter runs it, the project-folder adapter (#7)
 * included, so it only asks for what a folder can hold. How each call maps onto a folder:
 *
 *   Library                     a workspace folder (or one connected project folder)
 *     listProjects              its project folders; id = SHA-256 of each source.<ext>
 *     createProject             a new <name>/ folder with source.<ext>
 *     openProject / deleteProject  that folder
 *     get/setLastOpened         a browser preference (not part of the format)
 *   ProjectStore                <project>/
 *     getSource                 source.<ext> (type ↔ extension)
 *     get/setRecipe             recipe.json (savedAt ↔ the file's modified time)
 *     get/setView               view.json: the view block (pins, later the comparison)
 *     put/get/list/deleteCheckpoint   checkpoints/<id>.json (holds the source hash)
 *     getThumbnail              checkpoints/<id>.png
 */
const adapters: [string, () => Promise<Library>][] = [
  ["memory", async () => memoryLibrary()],
  ["indexeddb", () => indexedDbLibrary({ factory: new IDBFactory() })],
];

describe.each(adapters)("storage contract: %s adapter", (_name, open) => {
  it("a project is one source, its id the content hash of the bytes", async () => {
    const lib = await open();
    const info = await lib.createProject(src("cat.png", 1, 2, 3));
    expect(info).toEqual({ id: await sha256Hex(bytes(1, 2, 3)), name: "cat.png" });
    const p = await lib.openProject(info.id);
    expect(p?.id).toBe(info.id);
    expect(p?.name).toBe("cat.png");
    const s = await p!.getSource();
    expect(s.type).toBe("image/png");
    expect([...s.bytes]).toEqual([1, 2, 3]);
    expect(await lib.openProject("nope")).toBeUndefined();
  });

  it("opening the same image again reopens its project, with its recipe", async () => {
    const lib = await open();
    const a = await lib.createProject(src("a.png", 9, 9));
    await (await lib.openProject(a.id))!.setRecipe({ recipe: { r: 1 }, savedAt: 5 });
    const again = await lib.createProject(src("renamed.png", 9, 9));
    const other = await lib.createProject(src("b.png", 9, 8));
    expect(again).toEqual(a);
    expect(other.id).not.toBe(a.id);
    expect((await lib.listProjects()).map((p) => p.id).sort()).toEqual([a.id, other.id].sort());
    expect(await (await lib.openProject(a.id))!.getRecipe()).toEqual({ recipe: { r: 1 }, savedAt: 5 });
    expect(await (await lib.openProject(other.id))!.getRecipe()).toBeUndefined();
  });

  it("deletes a project with its recipe and checkpoints", async () => {
    const lib = await open();
    const { id } = await lib.createProject(src("x.png", 4));
    const p = (await lib.openProject(id))!;
    await p.setRecipe({ recipe: {}, savedAt: 1 });
    await p.putCheckpoint(cp("c1", id), bytes(1));
    await lib.deleteProject(id);
    expect(await lib.openProject(id)).toBeUndefined();
    expect(await lib.listProjects()).toEqual([]);
    // Recreating it starts empty.
    await lib.createProject(src("x.png", 4));
    const fresh = (await lib.openProject(id))!;
    expect(await fresh.listCheckpoints()).toEqual([]);
    expect(await fresh.getRecipe()).toBeUndefined();
    expect(await fresh.getThumbnail("c1")).toBeUndefined();
  });

  it("keeps each project's view block beside its recipe, apart from it", async () => {
    const lib = await open();
    const a = (await lib.openProject((await lib.createProject(src("a.png", 1))).id))!;
    const b = (await lib.openProject((await lib.createProject(src("b.png", 2))).id))!;
    expect(await a.getView()).toBeUndefined();
    await a.setRecipe({ recipe: { r: 1 }, savedAt: 1 });
    await a.setView({ version: 1, pins: ["fill"] });
    expect(await a.getView()).toEqual({ version: 1, pins: ["fill"] });
    expect(await b.getView()).toBeUndefined();
    // Saving the view is not a recipe edit and makes no checkpoint.
    expect(await a.getRecipe()).toEqual({ recipe: { r: 1 }, savedAt: 1 });
    expect(await a.listCheckpoints()).toEqual([]);
    await a.setView({ version: 1, pins: [] });
    expect(await (await lib.openProject(a.id))!.getView()).toEqual({ version: 1, pins: [] });
    // It goes with the project.
    await lib.deleteProject(a.id);
    await lib.createProject(src("a.png", 1));
    expect(await (await lib.openProject(a.id))!.getView()).toBeUndefined();
  });

  it("remembers the last opened project", async () => {
    const lib = await open();
    expect(await lib.getLastOpened()).toBeUndefined();
    await lib.setLastOpened("abc");
    expect(await lib.getLastOpened()).toBe("abc");
  });

  it("keeps each project's checkpoints apart, thumbnails beside them", async () => {
    const lib = await open();
    const a = (await lib.openProject((await lib.createProject(src("a.png", 1))).id))!;
    const b = (await lib.openProject((await lib.createProject(src("b.png", 2))).id))!;
    await a.putCheckpoint(cp("1", a.id), bytes(7, 7));
    await b.putCheckpoint(cp("2", b.id));
    await a.putCheckpoint(cp("3", a.id));
    expect((await a.listCheckpoints()).map((c) => c.id).sort()).toEqual(["1", "3"]);
    expect((await b.listCheckpoints()).map((c) => c.id)).toEqual(["2"]);
    expect(await a.getCheckpoint("2")).toBeUndefined();
    expect(await b.getCheckpoint("2")).toEqual(cp("2", b.id));
    expect([...(await a.getThumbnail("1"))!]).toEqual([7, 7]);
    expect(await b.getThumbnail("2")).toBeUndefined();
    // Putting again replaces the record and keeps the thumbnail when none is given.
    await a.putCheckpoint({ ...cp("1", a.id), name: "dark" });
    expect((await a.getCheckpoint("1"))?.name).toBe("dark");
    expect(await a.getThumbnail("1")).toBeDefined();
    await a.deleteCheckpoint("1");
    expect(await a.getCheckpoint("1")).toBeUndefined();
    expect(await a.getThumbnail("1")).toBeUndefined();
    expect((await a.listCheckpoints()).map((c) => c.id)).toEqual(["3"]);
  });

  it("returns copies, so callers can't change what is stored", async () => {
    const lib = await open();
    const input = src("a.png", 1, 2);
    const p = (await lib.openProject((await lib.createProject(input)).id))!;
    input.bytes[0] = 99;
    (await p.getSource()).bytes[1] = 99;
    expect([...(await p.getSource()).bytes]).toEqual([1, 2]);

    const r = { recipe: { a: 1 }, savedAt: 1 };
    await p.setRecipe(r);
    r.recipe.a = 2;
    ((await p.getRecipe())!.recipe as { a: number }).a = 3;
    expect(await p.getRecipe()).toEqual({ recipe: { a: 1 }, savedAt: 1 });

    const c = cp("k", p.id);
    const thumb = bytes(5);
    await p.putCheckpoint(c, thumb);
    c.name = "changed";
    thumb[0] = 0;
    (await p.getCheckpoint("k"))!.name = "changed too";
    (await p.listCheckpoints())[0]!.note = "and this";
    (await p.getThumbnail("k"))![0] = 0;
    expect(await p.getCheckpoint("k")).toEqual(cp("k", p.id));
    expect([...(await p.getThumbnail("k"))!]).toEqual([5]);

    const view = { version: 1, pins: ["a"] };
    await p.setView(view);
    view.pins.push("b");
    ((await p.getView()) as { pins: string[] }).pins.push("c");
    expect(await p.getView()).toEqual({ version: 1, pins: ["a"] });
  });
});

/** An IDBFactory whose open() hands back a request we control. */
function stuckFactory(onOpen: (req: Record<string, unknown>) => void = () => {}) {
  const closed: string[] = [];
  return {
    closed,
    factory: {
      open() {
        const req: Record<string, unknown> = {};
        queueMicrotask(() => onOpen(req));
        return req;
      },
    } as unknown as IDBFactory,
  };
}

describe("indexeddb adapter", () => {
  it("survives a reload: a second open of the same database sees the data", async () => {
    const factory = new IDBFactory();
    const lib1 = await indexedDbLibrary({ factory });
    const { id } = await lib1.createProject(src("p.png", 5, 6));
    await (await lib1.openProject(id))!.setRecipe({ recipe: { r: 1 }, savedAt: 2 });
    await lib1.setLastOpened(id);
    const lib2 = await indexedDbLibrary({ factory });
    expect(await lib2.getLastOpened()).toBe(id);
    const p = (await lib2.openProject(id))!;
    expect(await p.getRecipe()).toEqual({ recipe: { r: 1 }, savedAt: 2 });
    expect([...(await p.getSource()).bytes]).toEqual([5, 6]);
    expect(lib2.persistent).toBe(true);
  });

  it("survives a reload with the view block", async () => {
    const factory = new IDBFactory();
    const lib1 = await indexedDbLibrary({ factory });
    const { id } = await lib1.createProject(src("p.png", 5, 6));
    await (await lib1.openProject(id))!.setView({ version: 1, pins: ["order"] });
    const lib2 = await indexedDbLibrary({ factory });
    expect(await (await lib2.openProject(id))!.getView()).toEqual({ version: 1, pins: ["order"] });
  });

  it("upgrades a database from before view blocks, keeping everything in it", async () => {
    const factory = new IDBFactory();
    // The version-1 layout, as the previous build made it.
    const open1 = factory.open("plotlab", 1);
    open1.onupgradeneeded = () => {
      const d = open1.result;
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("sources");
      d.createObjectStore("recipes");
      d.createObjectStore("checkpoints", { keyPath: "id" }).createIndex("byProject", "sourceHash");
      d.createObjectStore("thumbnails");
      d.createObjectStore("kv");
    };
    const db = await new Promise<IDBDatabase>((r) => (open1.onsuccess = () => r(open1.result)));
    const t = db.transaction(["projects", "sources", "recipes"], "readwrite");
    t.objectStore("projects").put({ id: "p1", name: "old.png", type: "image/png" });
    t.objectStore("sources").put(bytes(1), "p1");
    t.objectStore("recipes").put({ recipe: { old: true }, savedAt: 3 }, "p1");
    await new Promise((r) => (t.oncomplete = r));
    db.close();

    const lib = await indexedDbLibrary({ factory });
    const p = (await lib.openProject("p1"))!;
    expect(await p.getRecipe()).toEqual({ recipe: { old: true }, savedAt: 3 });
    expect(await p.getView()).toBeUndefined();
    await p.setView({ version: 1, pins: ["x"] });
    expect(await p.getView()).toEqual({ version: 1, pins: ["x"] });
  });

  it("rejects with an Error when IndexedDB isn't there", async () => {
    await expect(indexedDbLibrary({ factory: undefined })).rejects.toThrow(Error);
  });

  it("gives up after a timeout if opening never settles", async () => {
    const { factory } = stuckFactory();
    await expect(indexedDbLibrary({ factory, timeoutMs: 20 })).rejects.toThrow(/didn't open/);
  });

  it("gives up when another tab blocks the upgrade", async () => {
    const { factory } = stuckFactory((req) => (req.onblocked as () => void)());
    await expect(indexedDbLibrary({ factory, timeoutMs: 5000 })).rejects.toThrow(/another tab/);
  });

  it("when another tab upgrades the database: closes, reports it, and later calls fail with a clear Error", async () => {
    const factory = new IDBFactory();
    let lost = 0;
    const lib = await indexedDbLibrary({ factory, onLost: () => lost++ });
    const { id } = await lib.createProject(src("p.png", 1));
    const p = (await lib.openProject(id))!;
    // A newer build opens the same database at a higher version.
    const next = factory.open("plotlab", 99);
    await new Promise((r) => (next.onsuccess = r));
    next.result.close();
    expect(lost).toBe(1);
    await expect(p.setRecipe({ recipe: {}, savedAt: 1 })).rejects.toThrow(/another tab/);
  });

  it("a callback that throws rejects with that error, no unhandled rejection", async () => {
    const lib = await indexedDbLibrary({ factory: new IDBFactory() });
    const { id } = await lib.createProject(src("p.png", 1));
    const p = (await lib.openProject(id))!;
    // A recipe that can't be cloned makes put() throw inside the transaction.
    await expect(p.setRecipe({ recipe: { f: () => 1 }, savedAt: 1 })).rejects.toBeInstanceOf(Error);
    // The library still works afterwards.
    await p.setRecipe({ recipe: { ok: true }, savedAt: 2 });
    expect((await p.getRecipe())?.recipe).toEqual({ ok: true });
  });
});
