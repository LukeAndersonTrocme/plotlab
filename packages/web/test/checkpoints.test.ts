import { describe, expect, it } from "vitest";
import { memoryLibrary, type Library, type ProjectStore } from "../src/storage/index.ts";
import { canUndo, commit, createHistory, preview, undo } from "../src/history.ts";
import { attachThumbnail, autoCheckpoint, createCheckpoint, deleteCheckpoint, listAllGrouped, listForProject, restoreCheckpoint, restoreFrom, restoreSafely, sameRecipe, updateCheckpoint } from "../src/checkpoints.ts";

const thumb = new Uint8Array([137, 80, 78, 71]);
async function project(lib: Library, name: string, ...b: number[]): Promise<ProjectStore> {
  return (await lib.openProject((await lib.createProject({ bytes: new Uint8Array(b), name, type: "image/png" })).id))!;
}
const parse = (r: unknown) => ({ recipe: r as { n: number }, warnings: [] as string[] });

describe("checkpoints", () => {
  it("creates one with recipe, source hash, thumbnail, name, note and time", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: { t: 1 }, thumbnail: thumb, name: " first ", now: 1000 });
    expect(cp).toMatchObject({ recipe: { t: 1 }, sourceHash: p.id, name: "first", note: "", createdAt: 1000 });
    expect(await p.getCheckpoint(cp.id)).toEqual(cp);
    expect([...(await p.getThumbnail(cp.id))!]).toEqual([...thumb]);
  });

  it("two saved in the same millisecond get different ids", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const a = await createCheckpoint(p, { recipe: {}, now: 5 });
    const b = await createCheckpoint(p, { recipe: {}, now: 5 });
    expect(a.id).not.toBe(b.id);
  });

  it("lists a project's checkpoints, newest first", async () => {
    const lib = memoryLibrary();
    const a = await project(lib, "a.png", 1);
    const b = await project(lib, "b.png", 2);
    await createCheckpoint(a, { recipe: { n: 1 }, now: 1 });
    await createCheckpoint(b, { recipe: { n: 2 }, now: 2 });
    await createCheckpoint(a, { recipe: { n: 3 }, now: 3 });
    expect((await listForProject(a)).map((c) => c.recipe)).toEqual([{ n: 3 }, { n: 1 }]);
  });

  it("lists checkpoints across projects: the current one first, then most recent; empty projects left out", async () => {
    const lib = memoryLibrary();
    const a = await project(lib, "one.png", 1);
    const b = await project(lib, "two.png", 2);
    const c = await project(lib, "three.png", 3);
    await project(lib, "empty.png", 4);
    await createCheckpoint(a, { recipe: { n: 1 }, now: 1 });
    await createCheckpoint(b, { recipe: { n: 2 }, now: 2 });
    await createCheckpoint(c, { recipe: { n: 3 }, now: 3 });
    await createCheckpoint(a, { recipe: { n: 5 }, now: 5 });
    const groups = await listAllGrouped(lib, b.id);
    expect(groups.map((g) => [g.project.name, g.checkpoints.map((x) => (x.recipe as { n: number }).n)])).toEqual([
      ["two.png", [2]],
      ["one.png", [5, 1]],
      ["three.png", [3]],
    ]);
  });

  it("renames, adds a note, and deletes", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: {}, thumbnail: thumb, now: 1 });
    await updateCheckpoint(p, cp.id, { name: "  soft lines  " });
    await updateCheckpoint(p, cp.id, { note: "try with blue ink" });
    expect(await p.getCheckpoint(cp.id)).toMatchObject({ name: "soft lines", note: "try with blue ink", createdAt: 1 });
    expect(await p.getThumbnail(cp.id)).toBeDefined();
    await deleteCheckpoint(p, cp.id);
    expect(await listForProject(p)).toEqual([]);
  });

  it("restoring is one history entry; Back returns to the state before", () => {
    let h = commit(createHistory({ n: 1 }), { n: 2 });
    h = preview(h, { n: 3 }); // mid-drag when the checkpoint is clicked
    const cp = { id: "x", createdAt: 0, sourceHash: "h", name: "", note: "", recipe: { n: 9 } };
    const { history, warnings } = restoreCheckpoint(h, cp, (r) => ({ recipe: r as { n: number }, warnings: ["old step upgraded"] }));
    expect(history.present).toEqual({ n: 9 });
    expect(history.past.length).toBe(h.past.length + 1);
    expect(warnings).toEqual(["old step upgraded"]);
    const back = undo(history);
    expect(back.present).toEqual({ n: 2 });
    expect(undo(back).present).toEqual({ n: 1 });
    expect(canUndo(undo(back))).toBe(false);
  });

  it("restoring a checkpoint of another image opens that project and its source, still one Back step", async () => {
    const lib = memoryLibrary();
    const a = await project(lib, "a.png", 1);
    const b = await project(lib, "b.png", 2, 2);
    const cp = await createCheckpoint(b, { recipe: { n: 7 }, now: 1 });
    const h = commit(createHistory({ n: 0 }), { n: 1 });
    const r = await restoreFrom(lib, a, cp, h, parse);
    expect(r.project.id).toBe(b.id);
    expect([...r.source!.bytes]).toEqual([2, 2]);
    expect(r.history.present).toEqual({ n: 7 });
    expect(undo(r.history).present).toEqual({ n: 1 });
    // Same image: no switch, no source to decode.
    const same = await restoreFrom(lib, b, cp, h, parse);
    expect(same.project).toBe(b);
    expect(same.source).toBeUndefined();
  });

  it("restoring a checkpoint whose project is gone keeps the current image and says so", async () => {
    const lib = memoryLibrary();
    const a = await project(lib, "a.png", 1);
    const b = await project(lib, "b.png", 2);
    const cp = await createCheckpoint(b, { recipe: { n: 7 }, now: 1 });
    await lib.deleteProject(b.id);
    const r = await restoreFrom(lib, a, cp, createHistory({ n: 0 }), parse);
    expect(r.project).toBe(a);
    expect(r.history.present).toEqual({ n: 7 });
    expect(r.warnings.join()).toMatch(/isn't stored/);
  });

  it("a thumbnail can be added after the checkpoint is saved (saving doesn't wait for the picture)", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: { n: 1 }, name: "x", now: 1 });
    expect(await p.getThumbnail(cp.id)).toBeUndefined();
    await attachThumbnail(p, cp.id, thumb);
    expect([...(await p.getThumbnail(cp.id))!]).toEqual([...thumb]);
    expect(await p.getCheckpoint(cp.id)).toEqual(cp);
    // A checkpoint deleted meanwhile stays deleted.
    await deleteCheckpoint(p, cp.id);
    await attachThumbnail(p, cp.id, thumb);
    expect(await listForProject(p)).toEqual([]);
  });
});

describe("saving before a change that replaces the recipe", () => {
  it("compares recipes by content, whatever the key order", () => {
    expect(sameRecipe({ a: 1, b: { c: [1, 2], d: 2 } }, { b: { d: 2, c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameRecipe({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameRecipe({ s: [1, 2] }, { s: [2, 1] })).toBe(false);
  });

  it("saves the recipe as a named checkpoint", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const r = await autoCheckpoint(p, { recipe: { n: 1 }, name: "Before “Fine hatching”", now: 4 });
    expect(r.created).toBe(true);
    expect(r.checkpoint).toMatchObject({ recipe: { n: 1 }, name: "Before “Fine hatching”", createdAt: 4 });
    expect(await listForProject(p)).toEqual([r.checkpoint]);
  });

  it("doesn't save a second copy of a recipe that's already a checkpoint", async () => {
    const p = await project(memoryLibrary(), "a.png", 1);
    const first = await createCheckpoint(p, { recipe: { n: 1, m: 2 }, now: 1 });
    const r = await autoCheckpoint(p, { recipe: { m: 2, n: 1 }, name: "Before restoring", now: 2 });
    expect(r).toEqual({ checkpoint: first, created: false });
    expect((await listForProject(p)).length).toBe(1);
  });

  it("restoring saves where you are first, then restores as one Back step", async () => {
    const lib = memoryLibrary();
    const p = await project(lib, "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: { n: 9 }, name: "soft", now: 1 });
    const h = commit(createHistory({ n: 0 }), { n: 5 });
    const r = await restoreSafely(lib, p, cp, h, parse, { name: "Before restoring “soft”", now: 2 });
    expect(r.saved?.created).toBe(true);
    expect(r.saved?.checkpoint).toMatchObject({ recipe: { n: 5 }, name: "Before restoring “soft”" });
    expect(r.history.present).toEqual({ n: 9 });
    expect(undo(r.history).present).toEqual({ n: 5 });
    expect((await listForProject(p)).map((c) => c.recipe)).toEqual([{ n: 5 }, { n: 9 }]);
  });

  it("restoring the checkpoint you're already on saves nothing new", async () => {
    const lib = memoryLibrary();
    const p = await project(lib, "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: { n: 9 }, now: 1 });
    const r = await restoreSafely(lib, p, cp, createHistory({ n: 9 }), parse, { name: "Before restoring", now: 2 });
    expect(r.saved).toEqual({ checkpoint: cp, created: false });
    expect((await listForProject(p)).length).toBe(1);
  });

  it("restoring a checkpoint of another image saves where you are in the current project", async () => {
    const lib = memoryLibrary();
    const a = await project(lib, "a.png", 1);
    const b = await project(lib, "b.png", 2);
    const cp = await createCheckpoint(b, { recipe: { n: 7 }, now: 1 });
    const r = await restoreSafely(lib, a, cp, createHistory({ n: 3 }), parse, { name: "Before restoring", now: 2 });
    expect(r.project.id).toBe(b.id);
    expect((await listForProject(a)).map((c) => c.recipe)).toEqual([{ n: 3 }]);
  });

  it("if saving first fails, nothing is restored", async () => {
    const lib = memoryLibrary();
    const p = await project(lib, "a.png", 1);
    const cp = await createCheckpoint(p, { recipe: { n: 9 }, now: 1 });
    const broken: ProjectStore = { ...p, listCheckpoints: p.listCheckpoints, putCheckpoint: async () => Promise.reject(new Error("disk full")) };
    await expect(restoreSafely(lib, broken, cp, createHistory({ n: 1 }), parse, { name: "Before restoring" })).rejects.toThrow("disk full");
  });
});


describe("a failed restore", () => {
  it("removes the 'Before restoring' checkpoint it saved, and rethrows", async () => {
    const lib = memoryLibrary();
    const p = await project(lib, "a.png", 1);
    const target = await createCheckpoint(p, { recipe: { n: 1 }, name: "t", now: 1 });
    const h = createHistory<{ n: number }>({ n: 2 });
    const bad = () => {
      throw new Error("unreadable");
    };
    await expect(restoreSafely(lib, p, target, h, bad, { name: "Before restoring t", now: 2 })).rejects.toThrow("unreadable");
    expect((await listForProject(p)).map((c) => c.id)).toEqual([target.id]);
  });
  it("keeps a checkpoint that already existed", async () => {
    const lib = memoryLibrary();
    const p = await project(lib, "a.png", 1);
    const target = await createCheckpoint(p, { recipe: { n: 1 }, now: 1 });
    const same = await createCheckpoint(p, { recipe: { n: 2 }, name: "mine", now: 2 });
    const bad = () => {
      throw new Error("x");
    };
    await expect(restoreSafely(lib, p, target, createHistory<{ n: number }>({ n: 2 }), bad, { name: "Before restoring", now: 3 })).rejects.toThrow();
    expect((await listForProject(p)).map((c) => c.id)).toContain(same.id);
  });
});
