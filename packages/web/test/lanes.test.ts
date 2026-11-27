import { describe, expect, it } from "vitest";
import { addInLane, lanesOf, loadRecipe, unlinkLanes, type Ink, type Plot, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { laneAddMenu, laneBoxes, laneKey, laneOrder, laneRows, moveLane, parseLaneKey, stackRows } from "../src/lanes.ts";

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
  it("each lane's boxes are keyed by step and ink, with their chain position", () => {
    const r = mixed();
    const boxes = laneBoxes(r, reg, { steps: [], stale: [] }, "M");
    expect(boxes.map((b) => [b.key, b.index, b.title])).toEqual([
      ["pixelate@M", 1, "Pixelate"],
      ["centerline@M", 2, "Centerline"],
    ]);
    expect(laneBoxes(r, reg, { steps: [], stale: [] }, "C").map((b) => b.key)).toEqual(["centerline@C"]);
  });
  it("rows come in pass order: all four, or the one ink chosen", () => {
    const r = mixed();
    const all = laneRows(r, reg, { steps: [], stale: [] }, plotOf(["Y", "M", "C", "K"]), "all");
    expect(all.map((l) => l.layer)).toEqual(["Y", "M", "C", "K"]);
    expect(all.map((l) => l.name)).toEqual(["Yellow", "Magenta", "Cyan", "Black"]);
    expect(laneRows(r, reg, { steps: [], stale: [] }, null, "M").map((l) => l.layer)).toEqual(["M"]);
    expect(laneRows(recipe(["threshold", "centerline", "order"]), reg, { steps: [], stale: [] }, null, "all")).toEqual([]);
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
