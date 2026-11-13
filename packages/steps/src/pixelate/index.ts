import { defineStep, type Layer } from "@plotlab/engine";
import { help } from "../help.generated.ts";

export const pixelate = defineStep({
  id: "pixelate",
  version: 1,
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
  },
  help: help.pixelate ?? "",
  runLayer(layer, p, _ctx, grid): Layer {
    const { width: w, height: h } = grid;
    const mmPerPx = grid.frame.widthMm / w;
    const cell = Math.max(1, Math.round(p.sizing === "mm" ? p.cellMm / mmPerPx : w / p.across));
    const v = layer.values;
    const forEachCell = (fn: (idx: number[]) => void) => {
      for (let cy = 0; cy < h; cy += cell) {
        for (let cx = 0; cx < w; cx += cell) {
          const idx: number[] = [];
          for (let y = cy; y < Math.min(h, cy + cell); y++) for (let x = cx; x < Math.min(w, cx + cell); x++) idx.push(y * w + x);
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
