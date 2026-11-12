import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  composite,
  decodeTiff,
  encodePng,
  encodeTiff,
  exportFormats,
  exportOutput,
  exportProof,
  finishPlot,
  halftone,
  registrationMarks,
  renderPlates,
  vectorToPdf,
  type Ink,
  type Layers,
  type Plot,
  type Recipe,
} from "../src/index.ts";

const black: Ink = { id: "k", name: "Black", color: "#000000", mix: "multiply", widthMm: 1 };
const cyan: Ink = { id: "c", name: "Cyan", color: "#00ffff", mix: "multiply", widthMm: 1 };
const magenta: Ink = { id: "m", name: "Magenta", color: "#ff00ff", mix: "multiply", widthMm: 1 };
const paper = { widthMm: 25.4, heightMm: 25.4 }; // 1 inch: pixels = dpi

function recipe(target: Recipe["target"], inks: Ink[] = [black], layerInks: Record<string, string> = {}): Recipe {
  return {
    schemaVersion: 2,
    input: "image",
    target,
    paper,
    layout: { fit: "fit", marginMm: 0, position: [0.5, 0.5] },
    workingMmPerPx: null,
    inks,
    layerInks,
    passOrder: "light-to-dark",
    machine: "generic",
    steps: [],
  };
}

const solid = (id: string, v: number): Layers => ({
  kind: "layers",
  width: 2,
  height: 2,
  frame: { xMm: 0, yMm: 0, widthMm: 25.4, heightMm: 25.4 },
  layers: [{ id, name: id, values: { kind: "tone", data: new Float32Array(4).fill(v) } }],
});

const linePlot = (ink: Ink): Plot => ({
  kind: "plot",
  paper,
  ordered: true,
  layers: [{ id: "lines", name: "Lines", ink, paths: [[[5, 12.7], [20, 12.7]]] }],
});

describe("encoders", () => {
  it("PNG round-trips through pngjs, with print DPI", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
    const png = PNG.sync.read(Buffer.from(encodePng({ width: 2, height: 2, format: "rgba", data }, 300)));
    expect([...png.data]).toEqual([...data]);
  });

  it("1-bit PNG writes ink as black", () => {
    const png = PNG.sync.read(Buffer.from(encodePng({ width: 3, height: 1, format: "bitmap", data: new Uint8Array([1, 0, 1]) })));
    expect([png.data[0], png.data[4], png.data[8]]).toEqual([0, 255, 0]);
  });

  it("TIFF round-trips: RGB, gray, and 1-bit with ink = black", () => {
    const rgb = decodeTiff(encodeTiff({ width: 2, height: 1, format: "rgb", data: new Uint8Array([255, 0, 0, 0, 0, 255]) }, 300))[0]!;
    expect(rgb.channels).toBe(3);
    expect([...rgb.data]).toEqual([1, 0, 0, 0, 0, 1]);
    const gray = decodeTiff(encodeTiff({ width: 2, height: 1, format: "gray", data: new Uint8Array([0, 255]) }, 300))[0]!;
    expect([...gray.data]).toEqual([0, 1]);
    const bits = decodeTiff(encodeTiff({ width: 10, height: 2, format: "bitmap", data: new Uint8Array(20).map((_, i) => i % 3 === 0 ? 1 : 0) }, 600))[0]!;
    expect([...bits.data.slice(0, 4)]).toEqual([0, 1, 1, 0]); // ink (1) reads back as black (0)
  });

  it("reads 16-bit TIFF without losing precision", () => {
    // Hand-built uncompressed little-endian 16-bit gray TIFF, 2×1 px.
    const tags: Array<[number, number, number, number]> = [
      [256, 3, 1, 2], [257, 3, 1, 1], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, 0], [277, 3, 1, 1], [278, 3, 1, 1], [279, 4, 1, 4],
    ];
    const ifdLen = 2 + tags.length * 12 + 4;
    const buf = new Uint8Array(8 + ifdLen + 4);
    const dv = new DataView(buf.buffer);
    buf.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
    dv.setUint16(8, tags.length, true);
    tags.forEach(([tag, type, count, v], i) => {
      const o = 10 + i * 12;
      dv.setUint16(o, tag, true);
      dv.setUint16(o + 2, type, true);
      dv.setUint32(o + 4, count, true);
      if (tag === 273) dv.setUint32(o + 8, 8 + ifdLen, true);
      else if (type === 3) dv.setUint16(o + 8, v, true);
      else dv.setUint32(o + 8, v, true);
    });
    dv.setUint16(8 + ifdLen, 1, true); // 1/65535: below one 8-bit step
    dv.setUint16(8 + ifdLen + 2, 32768, true);
    const img = decodeTiff(buf)[0]!;
    expect(img.data[0]).toBeCloseTo(1 / 65535, 8);
    expect(img.data[1]).toBeCloseTo(32768 / 65535, 6);
  });
});

describe("renderPlates + composite", () => {
  it("multiply: cyan over magenta makes blue, like ink on paper", () => {
    const ls: Layers = { ...solid("a", 1), layers: [...solid("a", 1).layers, ...solid("b", 1).layers.map((l) => ({ ...l, id: "b", name: "b" }))] };
    const r = recipe({ kind: "raster", dpi: 10 }, [cyan, magenta], { a: "c", b: "m" });
    const out = renderPlates(ls, null, { ...r, inkFor: (id) => (id === "a" ? cyan : magenta) }, 10);
    expect(out.plates.map((p) => p.ink.id).sort()).toEqual(["c", "m"]);
    const px = composite(out);
    expect([px[0], px[1], px[2]]).toEqual([0, 0, 255]);
  });

  it("normal mix covers what is under it; pass order decides what is on top", () => {
    const yellow: Ink = { ...cyan, id: "y", color: "#ffff00", mix: "normal" };
    const base = recipe({ kind: "raster", dpi: 50 }, [black, yellow]);
    const s = { ...base, passOrder: ["a", "lines"], inkFor: () => black };
    const px = composite(renderPlates(solid("a", 1), linePlot(yellow), s, 50));
    const mid = (Math.round(12.7 * (50 / 25.4)) * 50 + 25) * 4;
    // Line centre sits on a pixel boundary, so the edge pixel is ~98% covered.
    expect(px[mid]).toBeGreaterThan(245);
    expect(px[mid + 1]).toBeGreaterThan(245);
    expect(px[mid + 2]).toBe(0);
    expect([px[0], px[1], px[2]]).toEqual([0, 0, 0]);
  });

  it("layers sharing an ink become one plate", () => {
    const two: Layers = { ...solid("a", 0.5), layers: [solid("a", 0.5).layers[0]!, { id: "b", name: "b", values: { kind: "tone", data: new Float32Array(4).fill(0.8) } }] };
    const out = renderPlates(two, null, { ...recipe({ kind: "print", dpi: 10, mode: "gray", halftone: null, negative: false }), inkFor: () => black }, 10);
    expect(out.plates).toHaveLength(1);
    expect(out.plates[0]!.layers).toEqual(["a", "b"]);
    expect(out.plates[0]!.coverage[0]).toBe(204);
  });

  it("strokes have their ink width", () => {
    const out = renderPlates(linePlot(black), linePlot(black), { ...recipe({ kind: "raster", dpi: 254 }), inkFor: () => black }, 254); // 10 px/mm, 1 mm line
    const col = 120; // x = 12 mm
    const inked = [...Array(out.height).keys()].filter((y) => out.plates[0]!.coverage[y * out.width + col]! > 127);
    expect(inked.length).toBe(10);
  });
});

describe("halftone", () => {
  it("dot area tracks tone", () => {
    for (const tone of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const W = 400, cov = new Uint8Array(W * W).fill(Math.round(tone * 255));
      const out = halftone(cov, W, W, 1200, 60, 15);
      const mean = out.reduce((s, v) => s + v, 0) / (255 * W * W);
      expect(Math.abs(mean - tone)).toBeLessThan(0.02);
    }
  });
});

describe("finishing", () => {
  it("adds registration marks to every pass and mirrors left-right", () => {
    const p = finishPlot(linePlot(black), { mirror: true, registration: true });
    expect(p.layers[0]!.paths.length).toBe(1 + registrationMarks(paper).length);
    expect(p.layers[0]!.paths[0]).toEqual([[20.4, 12.7], [5.4, 12.7]].map(([x, y]) => [expect.closeTo(x!, 6), y]));
  });

  it("mirrors raster plates", () => {
    const ls: Layers = { ...solid("a", 0), layers: [{ id: "a", name: "a", values: { kind: "tone", data: new Float32Array([1, 0, 1, 0]) } }] };
    const t = { kind: "print" as const, dpi: 2, mode: "gray" as const, halftone: null, negative: false };
    const plain = renderPlates(ls, null, { ...recipe(t), inkFor: () => black }, 2).plates[0]!.coverage;
    const flipped = renderPlates(ls, null, { ...recipe({ ...t, mirror: true }), inkFor: () => black }, 2).plates[0]!.coverage;
    expect([plain[0], plain[1]]).toEqual([255, 0]);
    expect([flipped[0], flipped[1]]).toEqual([0, 255]);
  });
});

describe("exportOutput", () => {
  it("offers formats per target", () => {
    expect(exportFormats({ kind: "plotter" })).toEqual(["svg"]);
    expect(exportFormats({ kind: "vector" })).toEqual(["svg", "pdf"]);
    expect(exportFormats({ kind: "raster", dpi: 300 })).toEqual(["png", "tiff"]);
  });

  it("vector SVG embeds layers that stopped early; plotter SVG leaves them out and says so", () => {
    const plot = { ...linePlot(black), rasterLayers: solid("t", 0.5) };
    const vec = exportOutput(plot, plot, recipe({ kind: "vector" }), "svg", "x");
    expect(String(vec.files[0]!.data)).toContain("data:image/png;base64,");
    const plt = exportOutput(plot, plot, recipe({ kind: "plotter" }), "svg", "x");
    expect(String(plt.files[0]!.data)).not.toContain("<image");
    expect(plt.notes[0]).toMatch(/left out of the plotter file: t/);
  });

  it("PDF has a valid xref", () => {
    const pdf = vectorToPdf({ plot: linePlot(black), rasters: { layers: solid("t", 0.5), inkFor: () => cyan }, recipe: { a: 1 } });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain("/BM /Multiply");
  });

  it("print prep writes one 1-bit TIFF per ink plus a proof", () => {
    const ls: Layers = { ...solid("a", 1), layers: [solid("a", 1).layers[0]!, { id: "b", name: "b", values: { kind: "tone", data: new Float32Array(4).fill(0.4) } }] };
    const r = recipe({ kind: "print", dpi: 100, mode: "bitmap", halftone: { lpi: 20, angles: {} }, negative: false, registration: true }, [cyan, magenta], { a: "c", b: "m" });
    const { files } = exportOutput(ls, null, r, "plates", "art");
    expect(files.map((f) => f.name)).toEqual(["art-1-Cyan.tif", "art-2-Magenta.tif", "art-proof.png"]);
    const plate = decodeTiff(files[1]!.data as Uint8Array)[0]!;
    expect(plate.width).toBe(100);
    const inked = plate.data.reduce((n, v) => n + (v < 0.5 ? 1 : 0), 0) / plate.data.length;
    expect(inked).toBeGreaterThan(0.33);
    expect(inked).toBeLessThan(0.5); // 40% halftone plus marks
  });

  it("proof for a plotter shows only lines", () => {
    const plot = { ...linePlot(black), rasterLayers: solid("t", 1) };
    const p = exportProof(plot, plot, recipe({ kind: "plotter" }), 100);
    expect(p.rgba[0]).toBe(255); // the tone layer would make this corner black
  });

});

describe("print target in recipes", () => {
  it("reads print and finishing options, defaulting what is missing, and round-trips", async () => {
    const { loadRecipe, StepRegistry } = await import("../src/index.ts");
    const base = { ...recipe({ kind: "plotter" }), steps: [] };
    const print = loadRecipe({ ...base, target: { kind: "print", dpi: 1200, halftone: { lpi: 60, angles: { k: 22.5 } }, mirror: true } }, new StepRegistry()).recipe;
    expect(print.target).toEqual({ kind: "print", dpi: 1200, mode: "bitmap", halftone: { lpi: 60, angles: { k: 22.5 } }, negative: false, mirror: true });
    expect(loadRecipe(JSON.parse(JSON.stringify(print)), new StepRegistry()).recipe.target).toEqual(print.target);
    const plotter = loadRecipe({ ...base, target: { kind: "plotter", registration: true } }, new StepRegistry()).recipe;
    expect(plotter.target).toEqual({ kind: "plotter", registration: true });
  });
});
