import { describe, expect, it } from "vitest";
import { describeEntry, enterAt, loadRecipe, Pipeline, RecipeError, type RawGeometry, type RawLayers } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
const recipe = (steps: string[], extra: Record<string, unknown> = {}) =>
  loadRecipe(
    {
      schemaVersion: 2,
      paper: { widthMm: 200, heightMm: 200 },
      layout: { fit: "fit", marginMm: 0, position: [0.5, 0.5] },
      inks: [{ id: "k", color: "#000", widthMm: 1 }],
      steps: steps.map((step) => ({ step })),
      ...extra,
    },
    reg,
  ).recipe;
const enabled = (r: { steps: Array<{ step: string; enabled?: boolean }> }) => r.steps.filter((s) => s.enabled !== false).map((s) => s.step);

const layersSource = (): RawLayers => {
  const w = 20, h = 10;
  const data = new Float32Array(w * h);
  for (let x = 5; x < 15; x++) data[5 * w + x] = 1; // a horizontal bar of ink
  return { kind: "layers", width: w, height: h, layers: [{ id: "cyan", name: "Cyan", values: { kind: "tone", data } }, { id: "empty", name: "Empty", values: { kind: "tone", data: new Float32Array(w * h) } }] };
};

const geometrySource = (): RawGeometry => ({
  kind: "geometry",
  widthMm: 100,
  heightMm: 50,
  layers: [{ id: "svg", name: "SVG", features: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [100, 50]] }, properties: {} }] } }],
});

describe("recipe input stage", () => {
  it("accepts layers and lines as entry stages, and rejects anything else", () => {
    expect(recipe(["centerline"], { input: "layers" }).input).toBe("layers");
    expect(recipe(["order"], { input: "geometry" }).input).toBe("geometry");
    expect(() => recipe([], { input: "banana" })).toThrow(RecipeError);
  });
});

describe("Pipeline with non-image sources", () => {
  it("places separations on the paper like an image and runs layer steps on them", async () => {
    const r = recipe(["centerline"], { input: "layers" });
    const { placed, output } = await new Pipeline(reg).run(layersSource(), r);
    expect(placed.kind).toBe("layers");
    // 20×10 px fitted into 200×200 mm: 200 mm wide, centred vertically.
    expect(placed.frame).toEqual({ xMm: 0, yMm: 50, widthMm: 200, heightMm: 100 });
    expect(placed.layers.map((l) => l.id)).toEqual(["cyan", "empty"]);
    expect(output.kind).toBe("geometry");
    if (output.kind !== "geometry") return;
    expect(output.layers.map((l) => l.id)).toEqual(["cyan", "empty"]);
    expect(output.layers[0]!.features.features.length).toBeGreaterThan(0);
  });
  it("places SVG geometry on the paper with the layout (fit, centred)", async () => {
    const { output, plot } = await new Pipeline(reg).run(geometrySource(), recipe(["order"], { input: "geometry" }));
    expect(output.kind).toBe("plot");
    // 100×50 mm fitted to 200×200 mm: ×2, centred vertically (y offset 50).
    expect(plot!.layers[0]!.paths[0]).toEqual([[0, 50], [200, 150]]);
  });
  it("a recipe with no steps on an SVG still gives a plot to export", async () => {
    const { plot } = await new Pipeline(reg).run(geometrySource(), recipe([], { input: "geometry" }));
    expect(plot!.layers[0]!.paths).toHaveLength(1);
  });
  it("says plainly when the source and the recipe's entry stage disagree", async () => {
    await expect(new Pipeline(reg).run(geometrySource(), recipe(["threshold"]))).rejects.toThrow(/source enters as lines, but the recipe starts at an image/);
  });
});

describe("enterAt", () => {
  const photo = recipe(["threshold", "centerline", "order"]);
  it("an SVG switches off the steps that come before lines; the rest fits", () => {
    const res = enterAt(photo, "geometry", reg);
    expect(res.recipe.input).toBe("geometry");
    expect(enabled(res.recipe)).toEqual(["order"]);
    expect(res.recipe.steps).toHaveLength(3); // kept, only switched off
    expect(res.switchedOff).toEqual(["Threshold", "Centerline"]);
    expect(res.issues).toEqual([]);
  });
  it("separations switch off only the image steps", () => {
    const res = enterAt(photo, "layers", reg);
    expect(enabled(res.recipe)).toEqual(["centerline", "order"]);
    expect(res.switchedOff).toEqual(["Threshold"]);
  });
  it("going back to a photo switches those steps on again", () => {
    const svgd = enterAt(photo, "geometry", reg).recipe;
    const back = enterAt(svgd, "image", reg);
    expect(enabled(back.recipe)).toEqual(["threshold", "centerline", "order"]);
    expect(back.switchedOn).toEqual(["Threshold", "Centerline"]);
  });
  it("same stage is a no-op", () => {
    const res = enterAt(photo, "image", reg);
    expect(res.recipe).toBe(photo);
    expect(describeEntry("photo.jpg", "image", res)).toBeNull();
  });
  it("reports what still doesn't fit, in plain words", () => {
    const r = recipe(["centerline", "order"], { input: "layers" });
    const res = enterAt(r, "image", reg);
    expect(res.issues[0]!.reason).toMatch(/Centerline needs layers, but at that point the chain has an image/);
    const msg = describeEntry("photo.jpg", "image", res)!;
    expect(msg).toMatch(/photo\.jpg enters as an image/);
    expect(msg).toMatch(/Centerline needs layers/);
  });
  it("the notice names what was switched off", () => {
    const msg = describeEntry("drawing.svg", "geometry", enterAt(photo, "geometry", reg))!;
    expect(msg).toMatch(/drawing\.svg enters as lines/);
    expect(msg).toMatch(/Switched off Threshold and Centerline/);
  });
});
