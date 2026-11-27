import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { indexedDbLibrary, memoryLibrary, type Library } from "../src/storage/index.ts";
import { createHistory } from "../src/history.ts";
import { attachThumbnail, autoCheckpoint, createCheckpoint, deleteCheckpoint, listForProject, restoreSafely, updateCheckpoint } from "../src/checkpoints.ts";
import { MAX_AUTO_CHECKPOINTS, registerKeeper } from "../src/prune.ts";
import { LruMap } from "../src/lru.ts";
import { once } from "../src/once.ts";

const thumb = new Uint8Array([1, 2, 3]);
const adapters: [string, () => Promise<Library>][] = [
  ["memory", async () => memoryLibrary()],
  ["indexeddb", () => indexedDbLibrary({ factory: new IDBFactory() })],
];

describe.each(adapters)("pruning automatic checkpoints: %s", (_n, open) => {
  const proj = async () => {
    const lib = await open();
    return (await lib.openProject((await lib.createProject({ bytes: new Uint8Array([9]), name: "a.png", type: "image/png" })).id))!;
  };

  it("keeps the newest 30 automatic ones, deletes the oldest with their pictures, never manual ones", async () => {
    const p = await proj();
    const manual = await createCheckpoint(p, { recipe: { m: 1 }, thumbnail: thumb, name: "keep me", now: 1 });
    const ids: string[] = [];
    for (let i = 0; i < MAX_AUTO_CHECKPOINTS + 5; i++) {
      const { checkpoint } = await autoCheckpoint(p, { recipe: { i }, name: `Before ${i}`, now: 100 + i });
      await p.putCheckpoint(checkpoint, thumb);
      ids.push(checkpoint.id);
    }
    const left = await listForProject(p);
    expect(left.filter((c) => c.auto)).toHaveLength(MAX_AUTO_CHECKPOINTS);
    expect(left.some((c) => c.id === manual.id)).toBe(true);
    expect(left.filter((c) => c.auto).map((c) => c.id).sort()).toEqual(ids.slice(5).sort());
    expect(await p.getThumbnail(ids[0]!)).toBeUndefined();
    expect(await p.getThumbnail(ids[5]!)).toBeDefined();
    expect(await p.getThumbnail(manual.id)).toBeDefined();
  });

  it("a renamed automatic checkpoint becomes manual and is kept", async () => {
    const p = await proj();
    const first = (await autoCheckpoint(p, { recipe: { i: -1 }, name: "Before x", now: 1 })).checkpoint;
    await updateCheckpoint(p, first.id, { name: "my favourite" });
    for (let i = 0; i < MAX_AUTO_CHECKPOINTS + 3; i++) await autoCheckpoint(p, { recipe: { i }, name: "Before y", now: 10 + i });
    expect((await listForProject(p)).some((c) => c.id === first.id)).toBe(true);
  });

  it("never prunes one a live reference points at", async () => {
    const p = await proj();
    const first = (await autoCheckpoint(p, { recipe: { i: -1 }, name: "Before x", now: 1 })).checkpoint;
    const off = registerKeeper(() => [first.id]);
    try {
      for (let i = 0; i < MAX_AUTO_CHECKPOINTS + 3; i++) await autoCheckpoint(p, { recipe: { i }, name: "Before y", now: 10 + i });
      expect((await listForProject(p)).some((c) => c.id === first.id)).toBe(true);
    } finally {
      off();
    }
  });

  it("a failed restore at the cap costs no old checkpoint", async () => {
    const p = await proj();
    for (let i = 0; i < MAX_AUTO_CHECKPOINTS; i++) await autoCheckpoint(p, { recipe: { i }, name: "Before y", now: 10 + i });
    const target = await createCheckpoint(p, { recipe: { t: 1 }, now: 1 });
    const bad = () => {
      throw new Error("x");
    };
    await expect(restoreSafely(await open(), p, target, createHistory({ n: 99 }), bad, { name: "Before restoring", now: 999 })).rejects.toThrow();
    expect((await listForProject(p)).filter((c) => c.auto)).toHaveLength(MAX_AUTO_CHECKPOINTS);
  });

  it("attaching a picture leaves a rename alone and doesn't bring back a deleted checkpoint", async () => {
    const p = await proj();
    const cp = (await autoCheckpoint(p, { recipe: { a: 1 }, name: "Before x", now: 1 })).checkpoint;
    await updateCheckpoint(p, cp.id, { name: "mine" });
    await attachThumbnail(p, cp.id, thumb);
    const after = (await p.getCheckpoint(cp.id))!;
    expect(after.name).toBe("mine");
    expect(after.auto).toBeUndefined();
    expect(await p.getThumbnail(cp.id)).toBeDefined();
    await deleteCheckpoint(p, cp.id);
    await attachThumbnail(p, cp.id, thumb);
    expect(await p.getCheckpoint(cp.id)).toBeUndefined();
    expect(await p.getThumbnail(cp.id)).toBeUndefined();
  });

  it("an existing checkpoint with the same recipe is reused and nothing is pruned", async () => {
    const p = await proj();
    await autoCheckpoint(p, { recipe: { a: 1 }, name: "Before x", now: 1 });
    expect((await autoCheckpoint(p, { recipe: { a: 1 }, name: "Before y", now: 2 })).created).toBe(false);
  });
});

describe("LruMap", () => {
  it("drops the least recently used past its limit", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.get("a");
    m.set("c", 3);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([1, undefined, 3]);
    expect(m.size).toBe(2);
  });
});

describe("once", () => {
  it("ignores calls while running, then allows the next", async () => {
    let n = 0;
    let release!: () => void;
    const run = once(() => new Promise<void>((r) => ((n += 1), (release = r))));
    const a = run();
    const b = run();
    expect(n).toBe(1);
    release();
    await Promise.all([a, b]);
    void run();
    expect(n).toBe(2);
  });
  it("allows the next call after a failure", async () => {
    let n = 0;
    const run = once(async () => {
      n += 1;
      throw new Error("x");
    });
    await run().catch(() => undefined);
    await run().catch(() => undefined);
    expect(n).toBe(2);
  });
});
