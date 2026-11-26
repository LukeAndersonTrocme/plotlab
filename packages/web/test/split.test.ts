import { describe, expect, it } from "vitest";
import { lanesOf, loadRecipe, type Recipe } from "@plotlab/engine";
import { applyPreset, createRegistry } from "@plotlab/steps";
import { createHistory, commit, type History } from "../src/history.ts";
import { addAt } from "../src/gaps.ts";
import { pickPreset } from "../src/gallery.ts";
import { listForProject, createCheckpoint } from "../src/checkpoints.ts";
import { canSplit, PRE_SPLIT, splitIntoCmyk, undoSplit } from "../src/split.ts";
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

  it("restores the pre-split checkpoint as one Back step, saving the split work first", async () => {
    const { library, project } = await open();
    const res = await splitIntoCmyk(project, before, reg);
    if ("reason" in res) throw new Error(res.reason);
    // A linked edit after the split.
    const edited = { ...res.recipe, steps: res.recipe.steps.map((s) => (s.step === "fill" ? { ...s, params: { ...s.params, minSpacing: 1.5 } } : s)) };
    let h: History<Recipe> = commit(commit(createHistory(before), res.recipe), edited);
    const undone = await undoSplit(library, project, h, parse, reg, res.saved?.checkpoint.id);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
    h = undone.history;
    expect(h.present).toEqual(before);
    expect(h.past.at(-1)).toEqual(edited);
    // The split work is kept as a checkpoint.
    const names = (await listForProject(project)).map((c) => c.name);
    expect(names).toContain("Before undoing the split");
  });

  it("finds the pre-split checkpoint after a reload (by content, not the remembered id)", async () => {
    const { library, project } = await open();
    await createCheckpoint(project, { recipe: recipe(["threshold", "centerline", "order"]), name: "older", now: 1 });
    const res = await splitIntoCmyk(project, before, reg, undefined, 5);
    if ("reason" in res) throw new Error(res.reason);
    const undone = await undoSplit(library, project, createHistory(res.recipe), parse, reg);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
  });

  it("without storage, Back's history gives the pre-split recipe", async () => {
    const res = await splitIntoCmyk(null, before, reg);
    if ("reason" in res) throw new Error(res.reason);
    const undone = await undoSplit(null, null, commit(createHistory(before), res.recipe), parse, reg);
    if ("reason" in undone) throw new Error(undone.reason);
    expect(undone.recipe).toEqual(before);
    expect(undone.history.present).toEqual(before);
  });

  it("says so when there's nothing to go back to", async () => {
    const split = addAt(before, reg, 0, "cmyk");
    if ("reason" in split) throw new Error(split.reason);
    expect(await undoSplit(null, null, createHistory(split.recipe), parse, reg)).toEqual({ reason: expect.stringMatching(/Couldn't find the recipe from before the split/) });
    expect(await undoSplit(null, null, createHistory(before), parse, reg)).toEqual({ reason: expect.stringMatching(/isn't split/) });
  });
});
