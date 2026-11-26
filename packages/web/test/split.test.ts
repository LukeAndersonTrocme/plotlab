import { describe, expect, it } from "vitest";
import { lanesOf, loadRecipe, type Recipe } from "@plotlab/engine";
import { applyPreset, createRegistry } from "@plotlab/steps";
import { createHistory, commit, type History } from "../src/history.ts";
import { addAt } from "../src/gaps.ts";
import { pickPreset } from "../src/gallery.ts";
import { listForProject, createCheckpoint } from "../src/checkpoints.ts";
import { canSplit, markSplit, PRE_SPLIT, splitIntoCmyk, undoSplit } from "../src/split.ts";
import { memoryLibrary, type Library, type ProjectStore } from "../src/storage/index.ts";

const reg = createRegistry();
const parse = (json: unknown) => {
  const { recipe, warnings } = loadRecipe(json, reg);
  return { recipe, warnings: warnings.map((w) => w.message) };
};
const recipe = (steps: string[]): Recipe =>
  loadRecipe({ schemaVersion: 4, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((step) => ({ step })) }, reg).recipe;
async function open(): Promise<{ library: Library; project: ProjectStore }> {
  const library = memoryLibrary();
  const project = (await library.openProject((await library.createProject({ bytes: new Uint8Array([1]), name: "mona.jpg", type: "image/jpeg" })).id))!;
  return { library, project };
}
const fourAndAStack = (r: Recipe) => {
  const v = lanesOf(r, reg);
  expect(v.lanes.map((l) => l.layer)).toEqual(["C", "M", "Y", "K"]);
  expect(v.linked).toBe(true);
  expect(v.stack.map((i) => r.steps[i]!.step)).toEqual(["order"]);
};

describe("splitting into CMYK", () => {
  const before = recipe(["tone", "levels", "bands", "fill", "order"]);

  it("all three entry points give four layers and a stack", async () => {
    // 1. "Split into CMYK" on the source's sidebar.
    const { project } = await open();
    const side = await splitIntoCmyk(project, before, reg);
    if ("reason" in side) throw new Error(side.reason);
    fourAndAStack(side.recipe);
    // 2. "Separate CMYK" in the "+" right after the source.
    const plus = addAt(before, reg, 0, "cmyk");
    if ("reason" in plus) throw new Error(plus.reason);
    fourAndAStack(plus.recipe);
    // 3. The "CMYK print" preset.
    const preset = await pickPreset(project, before, "cmyk-print", (r) => ({ recipe: r, note: null }));
    fourAndAStack(preset.recipe);
    expect(preset.recipe).toEqual(applyPreset(before, "cmyk-print"));
  });

  it("saves the pre-split checkpoint first, turns the print screen angles on, and says what happened", async () => {
    const { project } = await open();
    const res = await splitIntoCmyk(project, before, reg);
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.screenAngles).toBe(true);
    expect(res.saved?.created).toBe(true);
    const cps = await listForProject(project);
    expect(cps.map((c) => c.name)).toEqual([PRE_SPLIT]);
    expect(parse(cps[0]!.recipe).recipe).toEqual(before);
    expect(res.message).toMatch(/Separate CMYK takes the place of Ink density/);
    expect(res.message).toMatch(/Undo the split/);
  });

  it("is only offered on a picture that isn't split yet", () => {
    expect(canSplit(before, reg)).toBe(true);
    const split = addAt(before, reg, 0, "cmyk");
    if ("reason" in split) throw new Error(split.reason);
    expect(canSplit(split.recipe, reg)).toBe(false);
    expect(canSplit({ ...before, input: "geometry" }, reg)).toBe(false);
  });
});

describe("undo the split", () => {
  const before = recipe(["tone", "levels", "bands", "fill", "order"]);
  const other = recipe(["threshold", "centerline", "order"]);
  /** A split as the app commits it: the mark first (what the split replaces), then the commit. */
  const commitSplit = (h: History<Recipe>, split: Recipe, checkpoint?: string) => ({ mark: markSplit(h, checkpoint), history: commit(h, split) });

  it("restores the recipe the split replaced as one Back step, saving the split work first", async () => {
    const { library, project } = await open();
    const res = await splitIntoCmyk(project, before, reg);
    if ("reason" in res) throw new Error(res.reason);
    const s = commitSplit(createHistory(before), res.recipe, res.saved?.checkpoint.id);
    // A linked edit after the split.
    const edited = { ...res.recipe, steps: res.recipe.steps.map((x) => (x.step === "fill" ? { ...x, params: { ...x.params, minSpacing: 1.5 } } : x)) };
    let h: History<Recipe> = commit(s.history, edited);
    const undone = await undoSplit(library, project, h, parse, reg, s.mark);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
    h = undone.history;
    expect(h.present).toEqual(before);
    expect(h.past.at(-1)).toEqual(edited);
    // The split work is kept as a checkpoint.
    const names = (await listForProject(project)).map((c) => c.name);
    expect(names).toContain("Before undoing the split");
  });

  it("after a reload (no mark), finds the pre-split checkpoint by content", async () => {
    const { library, project } = await open();
    await createCheckpoint(project, { recipe: other, name: "older", now: 1 });
    const res = await splitIntoCmyk(project, before, reg, undefined, 5);
    if ("reason" in res) throw new Error(res.reason);
    const undone = await undoSplit(library, project, createHistory(res.recipe), parse, reg, null);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
  });

  it("a split recipe restored or loaded (mark cleared): Undo uses the pre-split checkpoint, not the previous recipe in Back's history", async () => {
    const { library, project } = await open();
    const res = await splitIntoCmyk(project, before, reg, undefined, 1);
    if ("reason" in res) throw new Error(res.reason);
    // Later, with another recipe open, the split one comes back by restore or load.
    const h = commit(createHistory(other), res.recipe);
    const undone = await undoSplit(library, project, h, parse, reg, null, 2);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
  });

  it("a mark that no longer matches Back's history (the entry moved or changed) isn't trusted", async () => {
    const { library, project } = await open();
    const res = await splitIntoCmyk(project, before, reg, undefined, 1);
    if ("reason" in res) throw new Error(res.reason);
    const stale = { ...markSplit(createHistory(other)), at: 0 };
    const undone = await undoSplit(library, project, commit(createHistory(other), res.recipe), parse, reg, { ...stale, before: before }, 2);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
  });

  it("split, undo the split, split again, then undo: back to the recipe from just before the second split", async () => {
    const { library, project } = await open();
    const first = await splitIntoCmyk(project, before, reg, undefined, 1);
    if ("reason" in first) throw new Error(first.reason);
    let s = commitSplit(createHistory(before), first.recipe, first.saved?.checkpoint.id);
    const u1 = await undoSplit(library, project, s.history, parse, reg, s.mark, 2);
    if ("reason" in u1) throw new Error(u1.reason);
    let h = commit(u1.history, other);
    const second = await splitIntoCmyk(project, other, reg, undefined, 3);
    if ("reason" in second) throw new Error(second.reason);
    s = commitSplit(h, second.recipe, second.saved?.checkpoint.id);
    h = commit(s.history, { ...second.recipe, screenAngles: false });
    const u2 = await undoSplit(library, project, h, parse, reg, s.mark, 4);
    if ("reason" in u2) throw new Error(u2.reason);
    expect(u2.recipe).toEqual(other);
  });

  it("after splitting, undoing, editing and picking the CMYK print preset, undo goes back to before the preset, not the first split", async () => {
    const { library, project } = await open();
    const first = await splitIntoCmyk(project, before, reg, undefined, 1);
    if ("reason" in first) throw new Error(first.reason);
    const s1 = commitSplit(createHistory(before), first.recipe, first.saved?.checkpoint.id);
    const u1 = await undoSplit(library, project, s1.history, parse, reg, s1.mark, 2);
    if ("reason" in u1) throw new Error(u1.reason);
    const edited = other;
    let h = commit(u1.history, edited);
    const preset = await pickPreset(project, edited, "cmyk-print", (r) => ({ recipe: r, note: null }), 3);
    const s2 = commitSplit(h, preset.recipe, preset.saved?.checkpoint.id);
    // The first split's mark is stale now; with it, the checkpoint fallback still finds the preset's.
    for (const mark of [s2.mark, s1.mark]) {
      const u2 = await undoSplit(library, project, s2.history, parse, reg, mark, 4);
      if ("reason" in u2) throw new Error(u2.reason);
      expect(u2.recipe).toEqual(edited);
    }
  });

  it("after a reload, prefers the checkpoint saved just before a split over a newer unrelated one", async () => {
    const { library, project } = await open();
    const edited = other;
    const preset = await pickPreset(project, edited, "cmyk-print", (r) => ({ recipe: r, note: null }), 5);
    await createCheckpoint(project, { recipe: recipe(["tone", "stipple", "order"]), name: "mine", now: 9 });
    const undone = await undoSplit(library, project, createHistory(preset.recipe), parse, reg, null);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(edited);
  });

  it("without storage, the mark into Back's history gives the pre-split recipe", async () => {
    const res = await splitIntoCmyk(null, before, reg);
    if ("reason" in res) throw new Error(res.reason);
    const s = commitSplit(createHistory(before), res.recipe);
    const undone = await undoSplit(null, null, s.history, parse, reg, s.mark);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
    expect(undone.history.present).toEqual(before);
  });

  it("says so when there's nothing to go back to", async () => {
    const split = addAt(before, reg, 0, "cmyk");
    if ("reason" in split) throw new Error(split.reason);
    // A loaded split recipe, no storage: Back's previous recipe isn't what the split replaced.
    expect(await undoSplit(null, null, commit(createHistory(other), split.recipe), parse, reg, null)).toEqual({ reason: expect.stringMatching(/Couldn't find the recipe from before the split/) });
    expect(await undoSplit(null, null, createHistory(before), parse, reg, null)).toEqual({ reason: expect.stringMatching(/isn't split/) });
  });
});
