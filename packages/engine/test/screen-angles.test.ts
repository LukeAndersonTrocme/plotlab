import { describe, expect, it } from "vitest";
import { loadRecipe, Pipeline, printScreenAngle, type Geometry, type RawImage } from "../src/index.ts";
import { createRegistry } from "../../steps/src/index.ts";

const reg = createRegistry();
// A colourful gradient, so every ink has something to hatch.
const W = 48, H = 48;
const data = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    data[i] = x / W;
    data[i + 1] = y / H;
    data[i + 2] = 0.3;
  }
const img: RawImage = { width: W, height: H, channels: 3, data };

const recipe = (screenAngles: boolean) =>
  loadRecipe(
    {
      schemaVersion: 4,
      screenAngles,
      target: { kind: "vector" },
      paper: { widthMm: 60, heightMm: 60 },
      layout: { fit: "fit", marginMm: 0, position: [0.5, 0.5] },
      workingMmPerPx: 1.25,
      inks: [{ id: "k", color: "#000" }],
      steps: [
        { step: "cmyk" },
        { step: "levels", params: { count: 2, smoothing: 0 } },
        { step: "bands", params: { simplify: 0 } },
        { step: "fill", params: { angle: 30, angleSpread: 0, mapping: "continuous", skipLightest: false, minSpacing: 2, maxSpacing: 2 } },
      ],
    },
    reg,
  ).recipe;

/** The direction of every hatch line in a layer, in degrees 0..180. */
function directions(geo: Geometry, layer: string): number[] {
  const l = geo.layers.find((x) => x.id === layer)!;
  return l.features.features.flatMap((f) => {
    if (f.geometry.type !== "LineString") return [];
    const [a, b] = f.geometry.coordinates as [number, number][];
    if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return [];
    return [((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 180];
  });
}
const same = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) < 1e-6;

describe("print screen angles in a linked split", () => {
  it("a linked Fill turns each ink's lattice by its print angle: C 15°, M 75°, Y 0°, K 45°", async () => {
    const off = (await new Pipeline(reg).run(img, recipe(false))).output as Geometry;
    const on = (await new Pipeline(reg).run(img, recipe(true))).output as Geometry;
    for (const [i, layer] of ["C", "M", "Y", "K"].entries()) {
      const base = directions(off, layer);
      const turned = directions(on, layer);
      expect(base.length, `${layer} has hatch lines`).toBeGreaterThan(0);
      expect(turned.length).toBeGreaterThan(0);
      // Off: every ink hatches at the Fill's own angle. On: offset by the ink's print angle.
      const at0 = base[0]!;
      expect(base.every((d) => same(d, at0))).toBe(true);
      const want = (at0 + printScreenAngle(layer, i)) % 180;
      expect(turned.every((d) => same(d, want)), `${layer}: ${at0} → ${turned[0]}, want ${want}`).toBe(true);
    }
  });
  it("only a split recipe turns its lattices: a single-ink recipe with the switch on is unchanged", async () => {
    const single = (on: boolean) => {
      const r = recipe(on);
      return { ...r, steps: [{ ...r.steps[0]!, id: "tone", step: "tone", params: { contrast: 1, gamma: 1, invert: false } }, ...r.steps.slice(1)] };
    };
    const a = (await new Pipeline(reg).run(img, loadRecipe(single(false), reg).recipe)).output as Geometry;
    const b = (await new Pipeline(reg).run(img, loadRecipe(single(true), reg).recipe)).output as Geometry;
    expect(directions(b, "tone")).toEqual(directions(a, "tone"));
  });
  it("switching the angles on or off reruns Fill (the cache key includes it)", async () => {
    const p = new Pipeline(reg);
    const a = (await p.run(img, recipe(false))).output as Geometry;
    const b = (await p.run(img, recipe(true))).output as Geometry;
    expect(directions(b, "C")[0]).not.toBeCloseTo(directions(a, "C")[0]!, 3);
  });
});
