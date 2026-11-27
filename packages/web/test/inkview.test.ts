import { describe, expect, it } from "vitest";
import { loadRecipe, unlinkLanes, type Ink, type Plot, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { drawOrder, inkCanvas } from "../src/inkview.ts";
import { clickLaneBox, initialView, RESULT, select, setCompare, setInkMix, setInkPanels, setMode, setOtherInks, SOURCE, stepSelection, type ViewState } from "../src/view.ts";
import { makeCompare } from "../src/compare.ts";

const reg = createRegistry();
const recipe = (steps: string[]): Recipe =>
  loadRecipe({ schemaVersion: 4, paper: { widthMm: 210, heightMm: 297 }, inks: [{ id: "k", color: "#000" }], steps: steps.map((step) => ({ step })) }, reg).recipe;
const ok = <T extends object>(res: T | { reason: string }): T => {
  if ("reason" in res) throw new Error(res.reason);
  return res;
};
const ink = (id: string): Ink => ({ id, name: id, color: "#000", mix: "multiply", widthMm: 0.5 });
const plotOf = (ids: string[]): Plot => ({ kind: "plot", paper: { widthMm: 100, heightMm: 100 }, ordered: true, layers: ids.map((id) => ({ id, name: id, ink: ink(id), paths: [] })) });
const none = new Set<string>();

const split = recipe(["cmyk", "centerline", "order"]);
const independent = ok(unlinkLanes(split, reg)).recipe;
const design = (patch: Partial<ViewState> = {}): ViewState => ({ ...initialView, ...patch });

describe("inkCanvas: the CMYK views apply only to a split picture, in Design, not comparing", () => {
  it("no split, another mode, or Compare stages: none of it", () => {
    expect(inkCanvas(design(), recipe(["threshold", "centerline", "order"]), reg, null, none)).toBeNull();
    expect(inkCanvas(setMode(design(), "plot"), split, reg, null, none)).toBeNull();
    const comparing = setCompare(design({ selection: stepSelection("centerline") }), makeCompare(["cmyk", "centerline"]));
    expect(inkCanvas(comparing, split, reg, null, none)).toBeNull();
    expect(inkCanvas(design(), split, reg, null, none)).not.toBeNull();
  });
});

describe("inkCanvas: four panels at the split, a step, or the stack", () => {
  const four = setInkPanels(initialView, "four");
  it("the split step, a lane step and the result are the split, a step and the stack", () => {
    expect(inkCanvas(select(four, stepSelection("cmyk")), split, reg, null, none)?.point).toBe("split");
    expect(inkCanvas(select(four, stepSelection("centerline")), split, reg, null, none)?.point).toBe("step");
    expect(inkCanvas(select(four, stepSelection("order")), split, reg, null, none)?.point).toBe("step");
    expect(inkCanvas(select(four, RESULT), split, reg, null, none)?.point).toBe("stack");
  });
  it("one panel per ink, C M Y K in the split's order, whatever the pass order", () => {
    const c = inkCanvas(select(four, RESULT), split, reg, plotOf(["Y", "K", "C", "M"]), none)!;
    expect(c.panels?.map((p) => [p.id, p.name])).toEqual([
      ["C", "Cyan"],
      ["M", "Magenta"],
      ["Y", "Yellow"],
      ["K", "Black"],
    ]);
  });
  it("before the split there are no inks yet: stacked, and no point", () => {
    const pre = recipe(["reaction", "cmyk", "centerline", "order"]);
    for (const sel of [SOURCE, stepSelection("reaction")]) {
      const c = inkCanvas(select(four, sel), pre, reg, null, none)!;
      expect(c.point).toBeNull();
      expect(c.panels).toBeNull();
    }
  });
  it("a hidden ink keeps its panel, marked hidden", () => {
    const c = inkCanvas(select(four, RESULT), split, reg, null, new Set(["Y"]))!;
    expect(c.panels?.map((p) => p.hidden)).toEqual([false, false, true, false]);
  });
  it("Independent: the panel of the ink the step was picked in is the current one", () => {
    const v = setInkPanels(clickLaneBox(initialView, "centerline", "M"), "four");
    expect(inkCanvas(v, independent, reg, null, none)!.panels?.map((p) => p.current)).toEqual([false, true, false, false]);
    // Linked: the step is every ink's, so no panel is current.
    expect(inkCanvas(select(four, stepSelection("centerline")), split, reg, null, none)!.panels?.every((p) => !p.current)).toBe(true);
  });
  it("stacked: no panels", () => {
    expect(inkCanvas(select(initialView, RESULT), split, reg, null, none)!.panels).toBeNull();
  });
});

describe("inkCanvas: one ink's step, with the other inks faintly underneath", () => {
  it("a step picked in an independent lane focuses that ink", () => {
    const v = clickLaneBox(initialView, "centerline", "M");
    expect(inkCanvas(v, independent, reg, null, none)).toMatchObject({ focus: "M", otherInks: true });
    expect(inkCanvas(setOtherInks(v, false), independent, reg, null, none)).toMatchObject({ focus: "M", otherInks: false });
  });
  it("no focus for a linked step, the result, or four panels", () => {
    expect(inkCanvas(select(initialView, stepSelection("centerline")), split, reg, null, none)!.focus).toBeNull();
    expect(inkCanvas(select(initialView, RESULT), independent, reg, null, none)!.focus).toBeNull();
    expect(inkCanvas(setInkPanels(clickLaneBox(initialView, "centerline", "M"), "four"), independent, reg, null, none)!.focus).toBeNull();
  });
  it("a lane that no longer has the step (taken out of M) isn't a focus", () => {
    const v = clickLaneBox(initialView, "centerline", "M");
    const narrowed: Recipe = { ...independent, steps: independent.steps.map((s) => (s.id === "centerline" ? { ...s, layers: ["C", "Y", "K"] } : s)) };
    expect(inkCanvas(v, narrowed, reg, null, none)!.focus).toBeNull();
  });
});

describe("inkCanvas: see-through or opaque", () => {
  it("opaque draws in the pass order (the lane order)", () => {
    const c = inkCanvas(setInkMix(initialView, "opaque"), split, reg, plotOf(["Y", "K", "C", "M"]), none)!;
    expect(c.opaque).toBe(true);
    expect(c.order).toEqual(["Y", "K", "C", "M"]);
    expect(inkCanvas(initialView, split, reg, null, none)!.opaque).toBe(false);
  });
});

const R = (id: string, color: string | null = "#0ff") => ({ id, color, mix: (color ? "multiply" : "normal") as "multiply" | "normal" });
const L = (id: string) => ({ id, mix: "multiply" as const });
const shape = (items: ReturnType<typeof drawOrder>) => items.map((i) => `${i.kind === "raster" ? "r" : "l"}:${i.id}${i.faint ? "~" : ""}:${i.mix === "multiply" ? "x" : "n"}`);

describe("drawOrder: what the canvas draws, bottom to top", () => {
  const rasters = [R("C"), R("M")];
  const lines = [L("Y"), L("K"), L("C")];
  it("by default, as before: images, the layers, then the lines, each with its own mix", () => {
    expect(shape(drawOrder([R("image", null), ...rasters], lines, { hidden: none }))).toEqual(["r:image:n", "r:C:x", "r:M:x", "l:Y:x", "l:K:x", "l:C:x"]);
  });
  it("by default, an image keeps its place among the layers (arrival order), as before", () => {
    expect(shape(drawOrder([R("C"), R("image", null), R("M")], [L("K")], { hidden: none }))).toEqual(["r:C:x", "r:image:n", "r:M:x", "l:K:x"]);
    // Opaque or a focus: images go underneath every ink.
    expect(shape(drawOrder([R("C"), R("image", null)], [], { hidden: none, opaque: true, order: ["C"] }))).toEqual(["r:image:n", "r:C:n"]);
  });
  it("hidden inks are left out, everywhere", () => {
    expect(shape(drawOrder(rasters, lines, { hidden: new Set(["C"]) }))).toEqual(["r:M:x", "l:Y:x", "l:K:x"]);
    expect(shape(drawOrder(rasters, lines, { hidden: new Set(["C"]), focus: "M", otherInks: true }))).toEqual(["l:Y~:x", "l:K~:x", "r:M:x"]);
    expect(shape(drawOrder(rasters, lines, { hidden: new Set(["C"]), focus: "C", otherInks: true }))).toEqual(["r:M~:x", "l:Y~:x", "l:K~:x"]);
  });
  it("opaque: ink by ink in the pass order, each ink's layer then its lines, with normal blending (later covers earlier)", () => {
    const order = ["K", "C", "M", "Y"];
    expect(shape(drawOrder([R("image", null), ...rasters], lines, { hidden: none, opaque: true, order }))).toEqual(["r:image:n", "l:K:n", "r:C:n", "l:C:n", "r:M:n", "l:Y:n"]);
    // Ids the order doesn't know go last, as they came.
    expect(shape(drawOrder([R("Z")], [L("C")], { hidden: none, opaque: true, order: ["C"] }))).toEqual(["l:C:n", "r:Z:n"]);
  });
  it("one ink's step: the others faintly underneath, that ink on top; without other inks, that ink alone", () => {
    expect(shape(drawOrder(rasters, lines, { hidden: none, focus: "C", otherInks: true }))).toEqual(["r:M~:x", "l:Y~:x", "l:K~:x", "r:C:x", "l:C:x"]);
    expect(shape(drawOrder([R("image", null), ...rasters], lines, { hidden: none, focus: "C", otherInks: false }))).toEqual(["r:image:n", "r:C:x", "l:C:x"]);
    // Opaque and faint: the faint inks in pass order too.
    expect(shape(drawOrder(rasters, lines, { hidden: none, focus: "C", otherInks: true, opaque: true, order: ["K", "M", "Y", "C"] }))).toEqual(["l:K~:n", "r:M~:n", "l:Y~:n", "r:C:n", "l:C:n"]);
  });
});
