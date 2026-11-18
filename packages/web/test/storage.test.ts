import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { indexedDbStore, memoryStore, sha256Hex, type ProjectStore } from "../src/storage/index.ts";

const bytes = (...b: number[]) => new Uint8Array(b);

/** The contract every adapter meets (ADR 0014). The folder adapter (#7) will run it too. */
const adapters: [string, () => Promise<ProjectStore>][] = [
  ["memory", async () => memoryStore()],
  ["indexeddb", () => indexedDbStore({ factory: new IDBFactory() })],
];

describe.each(adapters)("storage contract: %s adapter", (_name, open) => {
  it("stores a source by its content hash and gives it back", async () => {
    const s = await open();
    const meta = await s.putSource(bytes(1, 2, 3), { name: "cat.png", type: "image/png" });
    expect(meta.hash).toBe(await sha256Hex(bytes(1, 2, 3)));
    expect(meta).toMatchObject({ name: "cat.png", type: "image/png", size: 3 });
    const got = await s.getSource(meta.hash);
    expect(got?.name).toBe("cat.png");
    expect([...got!.bytes]).toEqual([1, 2, 3]);
    expect(await s.getSource("nope")).toBeUndefined();
  });

  it("the same bytes give the same hash and are stored once", async () => {
    const s = await open();
    const a = await s.putSource(bytes(9, 9), { name: "a.jpg", type: "image/jpeg" });
    const b = await s.putSource(bytes(9, 9), { name: "renamed.jpg", type: "image/jpeg" });
    const c = await s.putSource(bytes(9, 8), { name: "other.jpg", type: "image/jpeg" });
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
    const list = await s.listSources();
    expect(list.map((m) => m.hash).sort()).toEqual([a.hash, c.hash].sort());
    // The first name sticks: re-adding the same image isn't a new source.
    expect(list.find((m) => m.hash === a.hash)?.name).toBe("a.jpg");
  });

  it("deletes a source", async () => {
    const s = await open();
    const { hash } = await s.putSource(bytes(4), { name: "x.png", type: "image/png" });
    await s.deleteSource(hash);
    expect(await s.getSource(hash)).toBeUndefined();
    expect(await s.listSources()).toEqual([]);
  });

  it("keeps the current recipe and its source", async () => {
    const s = await open();
    expect(await s.getCurrent()).toBeUndefined();
    await s.setCurrent({ recipe: { steps: [1] }, sourceHash: "abc" });
    await s.setCurrent({ recipe: { steps: [2] }, sourceHash: "abc" });
    expect(await s.getCurrent()).toEqual({ recipe: { steps: [2] }, sourceHash: "abc" });
  });

  it("puts, lists, gets and deletes checkpoints, thumbnails apart", async () => {
    const s = await open();
    const cp = (id: string, sourceHash: string, createdAt: number) => ({ id, sourceHash, createdAt, recipe: { id }, name: "", note: "" });
    await s.putCheckpoint(cp("a", "s1", 1), bytes(7, 7));
    await s.putCheckpoint(cp("b", "s2", 2));
    await s.putCheckpoint(cp("c", "s1", 3));
    expect((await s.listCheckpoints()).map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
    expect((await s.listCheckpoints({ sourceHash: "s1" })).map((c) => c.id).sort()).toEqual(["a", "c"]);
    expect(await s.getCheckpoint("b")).toEqual(cp("b", "s2", 2));
    expect([...(await s.getThumbnail("a"))!]).toEqual([7, 7]);
    expect(await s.getThumbnail("b")).toBeUndefined();
    // Putting again replaces the record but keeps the thumbnail when none is given.
    await s.putCheckpoint({ ...cp("a", "s1", 1), name: "dark" });
    expect((await s.getCheckpoint("a"))?.name).toBe("dark");
    expect(await s.getThumbnail("a")).toBeDefined();
    await s.deleteCheckpoint("a");
    expect(await s.getCheckpoint("a")).toBeUndefined();
    expect(await s.getThumbnail("a")).toBeUndefined();
    expect((await s.listCheckpoints()).map((c) => c.id).sort()).toEqual(["b", "c"]);
  });

  it("returns copies, so callers can't change what is stored", async () => {
    const s = await open();
    await s.setCurrent({ recipe: { a: 1 }, sourceHash: "h" });
    const c = await s.getCurrent();
    (c!.recipe as { a: number }).a = 2;
    expect(await s.getCurrent()).toEqual({ recipe: { a: 1 }, sourceHash: "h" });
  });
});

describe("indexeddb adapter", () => {
  it("survives a reload: a second open of the same database sees the data", async () => {
    const factory = new IDBFactory();
    const s1 = await indexedDbStore({ factory });
    const { hash } = await s1.putSource(bytes(5, 6), { name: "p.png", type: "image/png" });
    await s1.setCurrent({ recipe: { r: 1 }, sourceHash: hash });
    const s2 = await indexedDbStore({ factory });
    expect(await s2.getCurrent()).toEqual({ recipe: { r: 1 }, sourceHash: hash });
    expect([...(await s2.getSource(hash))!.bytes]).toEqual([5, 6]);
    expect(s2.persistent).toBe(true);
  });

  it("rejects when IndexedDB isn't there", async () => {
    await expect(indexedDbStore({ factory: undefined })).rejects.toThrow();
  });
});
