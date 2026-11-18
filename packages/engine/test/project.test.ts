import { describe, expect, it } from "vitest";
import { inkFor, loadRecipe, showsTime, StepRegistry, toPlot, workingMmPerPx, type Geometry, type Ink, type Recipe } from "../src/index.ts";

const ink = (id: string, color: string, widthMm = 0.5): Ink => ({ id, name: id, color, mix: "multiply", widthMm });
const recipe = (over: Partial<Recipe> = {}): Recipe =>
  loadRecipe({ schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [ink("k", "#000000", 0.3)], steps: [], ...over }, new StepRegistry()).recipe;

describe("workingMmPerPx", () => {
  it("plotter: half the narrowest ink", () => expect(workingMmPerPx(recipe())).toBeCloseTo(0.15));
  it("raster: from DPI", () => expect(workingMmPerPx(recipe({ target: { kind: "raster", dpi: 300 } }))).toBeCloseTo(0.08467, 4));
  it("override wins", () => expect(workingMmPerPx(recipe({ workingMmPerPx: 0.5 }))).toBe(0.5));
});

describe("showsTime", () => {
  it("only for plotters", () => {
    expect(showsTime({ kind: "plotter" })).toBe(true);
    expect(showsTime({ kind: "raster", dpi: 300 })).toBe(false);
  });
});

describe("inks and passes", () => {
  const geo: Geometry = {
    kind: "geometry",
    paper: { widthMm: 100, heightMm: 100 },
    layers: ["dark", "light"].map((id) => ({
      id,
      name: id,
      features: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} }] },
    })),
  };
  const r = recipe({ inks: [ink("k", "#000000"), ink("y", "#ffff00")], layerInks: { light: "y" } });
  it("inkFor maps layers, falling back to the first ink", () => {
    expect(inkFor(r, "light").id).toBe("y");
    expect(inkFor(r, "dark").id).toBe("k");
  });
  it("light-to-dark puts the light ink first; traced order is flagged", () => {
    const p = toPlot(geo, { paper: r.paper, inkFor: (id) => inkFor(r, id), passOrder: r.passOrder });
    expect(p.layers.map((l) => l.id)).toEqual(["light", "dark"]);
    expect(p.ordered).toBe(false);
  });
  it("an explicit pass order wins", () => {
    const p = toPlot(geo, { paper: r.paper, inkFor: (id) => inkFor(r, id), passOrder: ["dark", "light"] });
    expect(p.layers.map((l) => l.id)).toEqual(["dark", "light"]);
  });
});

describe("recipe v2 validation", () => {
  it("rejects a recipe without inks and an unknown target", () => {
    expect(() => recipe({ inks: [] })).toThrow(/at least one ink/);
    expect(() => recipe({ target: { kind: "laser" } as never })).toThrow(/target/);
  });
  it("drops layerInks that point at missing inks, with a warning", () => {
    const { recipe: r, warnings } = loadRecipe(
      { schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [ink("k", "#000")], layerInks: { a: "nope" }, steps: [] },
      new StepRegistry(),
    );
    expect(r.layerInks).toEqual({});
    expect(warnings[0]?.message).toMatch(/nope/);
  });
});

describe("time budget (plotter targets)", () => {
  const load = (target: unknown) =>
    loadRecipe({ schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [ink("k", "#000000", 0.3)], steps: [], target }, new StepRegistry());

  it("round-trips a budget in minutes", () => {
    const { recipe, warnings } = load({ kind: "plotter", budgetMin: 5 });
    expect(recipe.target).toEqual({ kind: "plotter", budgetMin: 5 });
    expect(warnings).toEqual([]);
    expect(load(JSON.parse(JSON.stringify(recipe.target))).recipe.target).toEqual(recipe.target);
  });
  it("absent means no budget", () => {
    expect("budgetMin" in load({ kind: "plotter" }).recipe.target).toBe(false);
  });
  it.each([0, -3, "5", Number.NaN, null])("drops an invalid budget (%s) with a warning", (budgetMin) => {
    const { recipe, warnings } = load({ kind: "plotter", budgetMin });
    expect("budgetMin" in recipe.target).toBe(false);
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/budgetMin/);
  });
  it("ignores a budget on non-plotter targets", () => {
    expect("budgetMin" in load({ kind: "vector", budgetMin: 5 }).recipe.target).toBe(false);
    expect("budgetMin" in load({ kind: "raster", dpi: 300, budgetMin: 5 }).recipe.target).toBe(false);
  });
});
