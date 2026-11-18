import { describe, expect, it } from "vitest";
import { memoryStore } from "../src/storage/index.ts";
import { createHistory, commit, undo, preview, canUndo } from "../src/history.ts";
import { createCheckpoint, deleteCheckpoint, listAllGrouped, listForSource, restoreCheckpoint, updateCheckpoint } from "../src/checkpoints.ts";
import { SAMPLE_SOURCE } from "../src/storage/index.ts";

const thumb = new Uint8Array([137, 80, 78, 71]);

describe("checkpoints", () => {
  it("creates one with recipe, source hash, thumbnail, name, note and time", async () => {
    const s = memoryStore();
    const cp = await createCheckpoint(s, { recipe: { t: 1 }, sourceHash: "h1", thumbnail: thumb, name: "first", now: 1000 });
    expect(cp).toMatchObject({ recipe: { t: 1 }, sourceHash: "h1", name: "first", note: "", createdAt: 1000 });
    expect(cp.id).toMatch(/\S/);
    expect(await s.getCheckpoint(cp.id)).toEqual(cp);
    expect([...(await s.getThumbnail(cp.id))!]).toEqual([...thumb]);
  });

  it("two saved in the same millisecond get different ids", async () => {
    const s = memoryStore();
    const a = await createCheckpoint(s, { recipe: {}, sourceHash: "h", now: 5 });
    const b = await createCheckpoint(s, { recipe: {}, sourceHash: "h", now: 5 });
    expect(a.id).not.toBe(b.id);
  });

  it("lists the current source's checkpoints, newest first", async () => {
    const s = memoryStore();
    await createCheckpoint(s, { recipe: { n: 1 }, sourceHash: "h1", now: 1 });
    await createCheckpoint(s, { recipe: { n: 2 }, sourceHash: "h2", now: 2 });
    await createCheckpoint(s, { recipe: { n: 3 }, sourceHash: "h1", now: 3 });
    expect((await listForSource(s, "h1")).map((c) => c.recipe)).toEqual([{ n: 3 }, { n: 1 }]);
  });

  it("lists all, grouped by source: current source first, then most recently used", async () => {
    const s = memoryStore();
    const h1 = (await s.putSource(new Uint8Array([1]), { name: "one.png", type: "image/png" })).hash;
    const h2 = (await s.putSource(new Uint8Array([2]), { name: "two.png", type: "image/png" })).hash;
    await createCheckpoint(s, { recipe: { n: 1 }, sourceHash: h1, now: 1 });
    await createCheckpoint(s, { recipe: { n: 2 }, sourceHash: h2, now: 2 });
    await createCheckpoint(s, { recipe: { n: 3 }, sourceHash: SAMPLE_SOURCE, now: 3 });
    await createCheckpoint(s, { recipe: { n: 4 }, sourceHash: "gone", now: 4 });
    await createCheckpoint(s, { recipe: { n: 5 }, sourceHash: h1, now: 5 });
    const groups = await listAllGrouped(s, h2);
    expect(groups.map((g) => [g.sourceHash, g.name, g.checkpoints.map((c) => (c.recipe as { n: number }).n)])).toEqual([
      [h2, "two.png", [2]],
      [h1, "one.png", [5, 1]],
      ["gone", "Missing image", [4]],
      [SAMPLE_SOURCE, "Sample (Mona Lisa)", [3]],
    ]);
    expect(groups.find((g) => g.sourceHash === "gone")?.available).toBe(false);
    expect(groups.find((g) => g.sourceHash === SAMPLE_SOURCE)?.available).toBe(true);
  });

  it("renames, adds a note, and deletes", async () => {
    const s = memoryStore();
    const cp = await createCheckpoint(s, { recipe: {}, sourceHash: "h", thumbnail: thumb, now: 1 });
    await updateCheckpoint(s, cp.id, { name: "  soft lines  " });
    await updateCheckpoint(s, cp.id, { note: "try with blue ink" });
    expect(await s.getCheckpoint(cp.id)).toMatchObject({ name: "soft lines", note: "try with blue ink", createdAt: 1 });
    expect(await s.getThumbnail(cp.id)).toBeDefined();
    await deleteCheckpoint(s, cp.id);
    expect(await listForSource(s, "h")).toEqual([]);
  });

  it("restoring is one history entry; Back returns to the state before", async () => {
    let h = commit(createHistory({ level: 1 }), { level: 2 });
    h = preview(h, { level: 3 }); // mid-drag when the checkpoint is clicked
    const cp = { id: "x", createdAt: 0, sourceHash: "h", name: "", note: "", recipe: { level: 9 } };
    const { history, warnings } = restoreCheckpoint(h, cp, (r) => ({ recipe: r as { level: number }, warnings: ["old step upgraded"] }));
    expect(history.present).toEqual({ level: 9 });
    expect(history.past.length).toBe(h.past.length + 1);
    expect(warnings).toEqual(["old step upgraded"]);
    const back = undo(history);
    expect(back.present).toEqual({ level: 2 });
    expect(undo(back).present).toEqual({ level: 1 });
    expect(canUndo(undo(back))).toBe(false);
  });
});
