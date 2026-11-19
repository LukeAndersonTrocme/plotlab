import { describe, expect, it } from "vitest";
import { memoryLibrary, type Library, type ProjectStore } from "../src/storage/index.ts";
import { canUndo, commit, createHistory, preview, undo } from "../src/history.ts";
import { createCheckpoint, deleteCheckpoint, listAllGrouped, listForProject, restoreCheckpoint, restoreFrom, updateCheckpoint } from "../src/checkpoints.ts";

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
});
