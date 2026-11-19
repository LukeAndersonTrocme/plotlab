import { describe, expect, it } from "vitest";
import { applyStep, defaultParams, featurePaths, loadRecipe, type Frame, type Geometry, type Ink, type Layers, type Position, type StepContext } from "@plotlab/engine";
import { cells, createRegistry, pixelate } from "../src/index.ts";

const ink: Ink = { id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.3 };
const ctx: StepContext = { paper: { widthMm: 60, heightMm: 60 }, target: { kind: "vector" }, inks: [ink], inkFor: () => ink, passOrder: "light-to-dark" };
const PX = defaultParams(pixelate.params);
const PC = defaultParams(cells.params);

/** A tone layer of `w`×`h` pixels on `frame`; every pixel a different darkness, so cell means differ. */
function layers(frame: Frame, w: number, h: number): Layers {
  const data = Float32Array.from({ length: w * h }, (_, i) => ((i * 7919) % 1009) / 1009);
  return { kind: "layers", width: w, height: h, frame, layers: [{ id: "l", name: "l", values: { kind: "tone", data } }] };
}
const pix = async (input: Layers, params: Partial<typeof PX> = {}) => ((await applyStep(pixelate, input, { params: { ...PX, ...params } }, ctx)) as Layers).layers[0]!.values.data;
const cellGeo = async (input: Layers, params: Partial<typeof PC> = {}) =>
  (await applyStep(cells, input, { params: { ...PC, mode: "outline", threshold: 0, ...params } }, ctx)) as Geometry;
const box = (p: Position[]) => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
};

/** Mm positions (on the paper) of the pixel edges where Pixelate's output changes, across x and y. */
function blockEdges(d: ArrayLike<number>, input: Layers) {
  const { width: w, height: h, frame } = input;
  const sx = frame.widthMm / w, sy = frame.heightMm / h;
  const xs = new Set<number>(), ys = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) if (d[y * w + x] !== d[y * w + x - 1]) xs.add(+(frame.xMm + x * sx).toFixed(9));
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) if (d[y * w + x] !== d[(y - 1) * w + x]) ys.add(+(frame.yMm + y * sy).toFixed(9));
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}
/** Interior mm positions of Grid cells' square edges. */
function cellEdges(g: Geometry, frame: Frame) {
  const xs = new Set<number>(), ys = new Set<number>();
  for (const p of g.layers[0]!.features.features.flatMap(featurePaths)) {
    const { l, r, t, b } = box(p);
    for (const x of [l, r]) if (x > frame.xMm + 1e-9 && x < frame.xMm + frame.widthMm - 1e-9) xs.add(+x.toFixed(9));
    for (const y of [t, b]) if (y > frame.yMm + 1e-9 && y < frame.yMm + frame.heightMm - 1e-9) ys.add(+y.toFixed(9));
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}

describe("Pixelate and Grid cells share one grid", () => {
  // A picture placed off the paper origin, 1 mm per pixel.
  const frame = { xMm: 3, yMm: 7, widthMm: 23, heightMm: 17 };
  const input = layers(frame, 23, 17);

  it("Pixelate's grid starts at the paper origin, not the picture's corner", async () => {
    const { xs, ys } = blockEdges(await pix(input, { cellMm: 5 }), input);
    expect(xs).toEqual([5, 10, 15, 20, 25]);
    expect(ys).toEqual([10, 15, 20]);
  });

  for (const [ox, oy] of [[0, 0], [2, -1], [-3, 1]] as const) {
    it(`block edges fall exactly on cell edges (offset ${ox}, ${oy} mm)`, async () => {
      const a = blockEdges(await pix(input, { cellMm: 5, offsetX: ox, offsetY: oy }), input);
      const b = cellEdges(await cellGeo(input, { cellMm: 5, offsetX: ox, offsetY: oy }), frame);
      expect(a).toEqual(b);
      expect(a.xs.length).toBeGreaterThan(2);
    });
  }

  for (const [c, ox, oy] of [[5, 0, 0], [5, 1.3, -2.2], [3.5, -0.7, 0.45], [2, 0.25, 0.25]] as const) {
    it(`each cell's Pixelate value is the Grid cells tone of the same pixels (cell ${c}, offset ${ox}, ${oy})`, async () => {
      const d = await pix(input, { cellMm: c, offsetX: ox, offsetY: oy });
      const g = await cellGeo(input, { cellMm: c, offsetX: ox, offsetY: oy });
      const feats = g.layers[0]!.features.features;
      expect(feats.length).toBeGreaterThan(4);
      for (const f of feats) {
        const { l, r, t, b } = box(featurePaths(f)[0]!);
        const inside: number[] = [];
        for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
          const mx = frame.xMm + x + 0.5, my = frame.yMm + y + 0.5;
          if (mx >= l && mx < r && my >= t && my < b) inside.push(d[y * input.width + x]!);
        }
        expect(inside.length).toBeGreaterThan(0);
        expect(new Set(inside).size).toBe(1);
        expect(inside[0]).toBeCloseTo(f.properties!.tone as number, 6);
      }
    });
  }

  it("offsets shift both grids by the given mm", async () => {
    const base = cellEdges(await cellGeo(input, { cellMm: 5 }), frame);
    const moved = cellEdges(await cellGeo(input, { cellMm: 5, offsetX: 1.5, offsetY: -2 }), frame);
    expect(moved.xs).toEqual([6.5, 11.5, 16.5, 21.5]);
    expect(moved.ys).toEqual([8, 13, 18, 23]);
    expect(base.xs).toEqual([5, 10, 15, 20, 25]);
    const pm = blockEdges(await pix(input, { cellMm: 5, offsetX: 2, offsetY: 3 }), input);
    expect(pm.xs).toEqual([7, 12, 17, 22]);
    expect(pm.ys).toEqual([8, 13, 18, 23]);
  });

  it("an offset of a whole cell gives the same grid", async () => {
    expect(await pix(input, { cellMm: 5, offsetX: 5, offsetY: -5 })).toEqual(await pix(input, { cellMm: 5 }));
  });

  it("offsets default to 0 and have the same range on both steps", () => {
    for (const k of ["offsetX", "offsetY"] as const) {
      expect(pixelate.params[k]).toMatchObject({ default: 0, unit: "mm" });
      const { help: _h, ...a } = pixelate.params[k];
      const { help: _g, ...b } = cells.params[k];
      expect(a).toEqual(b);
    }
  });
});

describe("Pixelate v1 recipes", () => {
  const recipe = { schemaVersion: 2, input: "layers", paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "k", name: "k", color: "#000", mix: "multiply", widthMm: 0.5 }], steps: [{ step: "pixelate", version: 1, params: { sizing: "mm", cellMm: 6, across: 40 } }] };
  it("still load, with no offset and the older-version warning", () => {
    const { recipe: r, warnings } = loadRecipe(recipe, createRegistry());
    expect(pixelate.version).toBe(2);
    expect(r.steps[0]!.version).toBe(2);
    expect(r.steps[0]!.params).toEqual({ sizing: "mm", cellMm: 6, across: 40, offsetX: 0, offsetY: 0 });
    expect(warnings.map((w) => w.message)).toContain("pixelate: recipe was written for v1, running v2; output may differ");
  });
});
