import { defineStep, type Layer } from "@plotlab/engine";
import { help } from "../help.generated.ts";
import { gridSpans, offsetParam } from "../cells/grid.ts";

/**
 * Big square cells over each layer. v2: the grid is the one Grid cells uses (../cells/grid.ts),
 * anchored at the paper's (0, 0) and moved by the offsets, with cells in exact mm; v1 laid
 * whole-pixel cells from the picture's top-left corner.
 */
export const pixelate = defineStep({
  id: "pixelate",
  version: 2,
  title: "Pixelate",
  summary: "Turn each layer into big square cells: tone is averaged per cell, levels take the most common one.",
  input: "layers",
  output: "layers",
  cost: "live",
  params: {
    sizing: {
      type: "enum",
      label: "Cell size by",
      help: "Set the cell size in millimetres, or how many cells fit across the picture.",
      options: [
        { value: "mm", label: "Millimetres" },
        { value: "across", label: "Cells across" },
      ],
      default: "mm",
    },
    cellMm: { type: "number", label: "Cell size", help: "Width of each square cell.", min: 0.5, max: 50, step: 0.5, default: 5, unit: "mm", visibleWhen: { param: "sizing", equals: ["mm"] } },
    across: { type: "number", label: "Cells across", help: "How many cells fit across the picture.", min: 4, max: 400, step: 1, default: 40, visibleWhen: { param: "sizing", equals: ["across"] } },
    offsetX: offsetParam("x"),
    offsetY: offsetParam("y"),
  },
  help: help.pixelate ?? "",
  runLayer(layer, p, _ctx, grid): Layer {
    const { width: w, height: h, frame } = grid;
    const cell = p.sizing === "mm" ? Math.max(0.5, p.cellMm) : frame.widthMm / p.across;
    // Every pixel lies in exactly one cell: the one holding its centre. Cells narrower than a
    // pixel hold no centre and are skipped.
    const rows = gridSpans(frame.yMm, frame.heightMm, h, cell, p.offsetY).filter((s) => s.hi > s.lo);
    const cols = gridSpans(frame.xMm, frame.widthMm, w, cell, p.offsetX).filter((s) => s.hi > s.lo);
    const v = layer.values;
    const idx: number[] = [];
    const forEachCell = (fn: (idx: number[]) => void) => {
      for (const r of rows) {
        for (const c of cols) {
          idx.length = 0;
          for (let y = r.lo; y < r.hi; y++) for (let x = c.lo; x < c.hi; x++) idx.push(y * w + x);
          fn(idx);
        }
      }
    };
    if (v.kind === "tone") {
      const data = new Float32Array(v.data.length);
      forEachCell((idx) => {
        const mean = idx.reduce((s, i) => s + v.data[i]!, 0) / idx.length;
        for (const i of idx) data[i] = mean;
      });
      return { ...layer, values: { kind: "tone", data } };
    }
    const data = new Uint16Array(v.data.length);
    const counts = new Uint32Array(v.count + 1);
    forEachCell((idx) => {
      counts.fill(0);
      for (const i of idx) counts[v.data[i]!]!++;
      let best = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
      for (const i of idx) data[i] = best;
    });
    return { ...layer, values: { ...v, data } };
  },
});
