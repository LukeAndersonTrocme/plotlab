import { describe, expect, it } from "vitest";
import { addInLane, lanesOf, loadRecipe, moveInLane, unlinkLanes, type Ink, type Plot, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { allInks, unlinkedNotice, laneAddMenu, laneBoxes, laneKey, laneNudge, laneOrder, stripHidden, laneRows, moveLane, parseLaneKey, stackRows } from "../src/lanes.ts";

const reg = createRegistry();
const recipe = (steps: string[]): Recipe =>
  loadRecipe({ schemaVersion: 4, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((step) => ({ step })) }, reg).recipe;
const ok = <T extends object>(res: T | { reason: string }): T => {
  if ("reason" in res) throw new Error(res.reason);
  return res;
};
const ink = (id: string): Ink => ({ id, name: id, color: "#000", mix: "multiply", widthMm: 0.5 });
/** A plot of the passes `ids`, in that order, each with `n` strokes. */
const plotOf = (ids: string[], n = 1): Plot => ({
  kind: "plot",
  paper: { widthMm: 100, heightMm: 100 },
  ordered: true,
  layers: ids.map((id) => ({ id, name: id, ink: ink(id), paths: Array.from({ length: n }, (): [number, number][] => [[0, 0], [1, 1]]) })),
});
const LAYERS = ["C", "M", "Y", "K"];

describe("lane keys", () => {
  it("name a step in one lane, and read back; the Stack box and plain steps aren't lane keys", () => {
    expect(parseLaneKey(laneKey("centerline", "M"))).toEqual({ id: "centerline", layer: "M" });
    expect(parseLaneKey("@stack")).toBeNull();
    expect(parseLaneKey("centerline")).toBeNull();
  });
});

describe("lane order is the pass order", () => {
  it("follows the plot's passes; inks without lines come last, in the split's order", () => {
    expect(laneOrder(LAYERS, plotOf(["Y", "M", "C", "K"]), "light-to-dark")).toEqual(["Y", "M", "C", "K"]);
    expect(laneOrder(LAYERS, plotOf(["K", "C"]), "light-to-dark")).toEqual(["K", "C", "M", "Y"]);
    // Before the plot has caught up, the recipe's own order.
    expect(laneOrder(LAYERS, null, ["K", "Y"])).toEqual(["K", "Y", "C", "M"]);
    expect(laneOrder(LAYERS, null, "light-to-dark")).toEqual(LAYERS);
  });
  it("dragging a lane gives a new passOrder, through Plot mode's movePass", () => {
    const plot = plotOf(["Y", "M", "C", "K"]);
    expect(moveLane(LAYERS, plot, "light-to-dark", 3, 0)).toEqual(["K", "Y", "M", "C"]);
    expect(moveLane(LAYERS, plot, "light-to-dark", 0, 2)).toEqual(["M", "C", "Y", "K"]);
    // Round trip: the lanes show the new order.
    const order = moveLane(LAYERS, plot, "light-to-dark", 3, 0) as string[];
    expect(laneOrder(LAYERS, plotOf(order), order)).toEqual(order);
  });
  it("an ink without lines isn't a pass, so it can't be moved; nor can a lane to where it is", () => {
    expect(moveLane(LAYERS, plotOf(["K", "C"]), "light-to-dark", 2, 0)).toEqual({ reason: expect.stringMatching(/M has no lines yet/) });
    expect(moveLane(LAYERS, null, "light-to-dark", 1, 0)).toEqual({ reason: expect.stringMatching(/no lines yet/) });
    expect(moveLane(LAYERS, plotOf(LAYERS), "light-to-dark", 1, 1)).toEqual({ reason: expect.stringMatching(/already/) });
    // A lane dropped past the inks without lines goes to the last pass.
    expect(moveLane(LAYERS, plotOf(["K", "C"]), "light-to-dark", 0, 3)).toEqual(["C", "K"]);
  });
});

describe("the Stack panel's rows", () => {
  it("one per ink in pass order, with its lines and time; inks without lines say so", () => {
    const plot = plotOf(["K", "C"], 3);
    const rows = stackRows(LAYERS, ["Cyan", "Magenta", "Yellow", "Black"], plot, null, "light-to-dark");
    expect(rows.map((r) => [r.id, r.name, r.lines, r.pass])).toEqual([
      ["K", "Black", 3, 0],
      ["C", "Cyan", 3, 1],
      ["M", "Magenta", 0, -1],
      ["Y", "Yellow", 0, -1],
    ]);
  });
});

describe("independent lanes in the strip", () => {
  const mixed = () => {
    let r = ok(unlinkLanes(recipe(["cmyk", "centerline", "order"]), reg)).recipe;
    r = ok(addInLane(r, reg, "M", "pixelate", 0)).recipe;
    return r;
  };
  it("a keyboard move in a lane goes one place along it, through the lane guard", () => {
    const r = ok(addInLane(mixed(), reg, "M", "levels", 0)).recipe;
    const lane = (x: Recipe) => lanesOf(x, reg).lanes.find((l) => l.layer === "M")!.steps.map((s) => s.step);
    expect(lane(r)).toEqual(["levels", "pixelate", "centerline"]);
    const res = laneNudge(r, reg, "pixelate", "M", -1);
    if ("reason" in res) throw new Error(res.reason);
    expect(res.to).toBe(0);
    expect(lane(res.recipe)).toEqual(["pixelate", "levels", "centerline"]);
    // Past Centerline it would get lines: refused with the drag's reason (moveInLane).
    const no = moveInLane(r, reg, "pixelate", "M", 2);
    expect("reason" in no).toBe(true);
    expect(laneNudge(r, reg, "pixelate", "M", 1)).toEqual(no);
    expect(laneNudge(r, reg, "levels", "M", -1)).toEqual({ reason: "Levels is already first in the Magenta lane." });
    // One form for the lane's name in every refusal: the ink's name, like the lane guard's own.
    expect("reason" in no && no.reason).toMatch(/in the Magenta lane/);
    expect(laneNudge(r, reg, "centerline", "M", 1)).toEqual({ reason: "Centerline is already last in the Magenta lane." });
  });
  it("the strip's own row leaves out the lane steps only while the inks are independent", () => {
    expect([...stripHidden(mixed(), reg)]).toEqual([1, 2]);
    expect([...stripHidden(recipe(["cmyk", "centerline", "order"]), reg)]).toEqual([]);
    expect([...stripHidden(recipe(["threshold", "centerline", "order"]), reg)]).toEqual([]);
  });
  it("each lane's boxes are keyed by step and ink, with their chain position", () => {
    const r = mixed();
    const boxes = laneBoxes(r, reg, { steps: [], staleIds: [] }, "M");
    expect(boxes.map((b) => [b.key, b.index, b.title])).toEqual([
      ["pixelate@M", 1, "Pixelate"],
      ["centerline@M", 2, "Centerline"],
    ]);
    expect(laneBoxes(r, reg, { steps: [], staleIds: [] }, "C").map((b) => b.key)).toEqual(["centerline@C"]);
  });
  it("rows come in pass order: all four, or the one ink chosen", () => {
    const r = mixed();
    const all = laneRows(r, reg, { steps: [], staleIds: [] }, plotOf(["Y", "M", "C", "K"]), "all");
    expect(all.map((l) => l.layer)).toEqual(["Y", "M", "C", "K"]);
    expect(all.map((l) => l.name)).toEqual(["Yellow", "Magenta", "Cyan", "Black"]);
    expect(laneRows(r, reg, { steps: [], staleIds: [] }, null, "M").map((l) => l.layer)).toEqual(["M"]);
    expect(laneRows(recipe(["threshold", "centerline", "order"]), reg, { steps: [], staleIds: [] }, null, "all")).toEqual([]);
  });
  it('a lane\'s "+" offers exactly what addInLane takes there, or says why nothing fits', () => {
    const r = mixed();
    const m = laneAddMenu(r, reg, "Y", 0);
    expect(m.options.map((o) => o.id)).toEqual(expect.arrayContaining(["pixelate", "levels"]));
    expect(m.options.map((o) => o.id)).not.toContain("order");
    for (const o of m.options) expect("recipe" in addInLane(r, reg, "Y", o.id, 0)).toBe(true);
    // After Centerline the ink is lines: only Fill works on it there.
    const end = laneAddMenu(r, reg, "Y", 1);
    expect(end.options.map((o) => o.id)).toEqual(["fill"]);
    expect(lanesOf(r, reg).lanes.length).toBe(4);
  });
});

describe("final review: cards without a lane, and silent unlinking", () => {
  it("allInks: a step in the lanes whose inks have their own settings", () => {
    const linked = recipe(["cmyk", "levels", "bands", "fill", "order"]);
    expect(allInks(linked, reg, "fill")).toBe(false);
    const u = ok(unlinkLanes(linked, reg)).recipe;
    expect(allInks(u, reg, "fill")).toBe(true);
    expect(allInks(u, reg, "order")).toBe(false);
    expect(allInks(u, reg, "cmyk")).toBe(false);
  });
  it("unlinkedNotice: says so when an edit makes linked inks independent, and only then", () => {
    const linked = recipe(["cmyk", "levels", "bands", "fill", "order"]);
    const own = { ...linked, steps: linked.steps.map((s) => (s.step === "levels" ? { ...s, layerParams: { C: { count: 3 } } } : s)) };
    expect(unlinkedNotice(linked, own, reg)).toMatch(/Independent: Cyan now has its own steps or settings/);
    expect(unlinkedNotice(own, own, reg)).toBeNull();
    expect(unlinkedNotice(linked, linked, reg)).toBeNull();
  });
});
