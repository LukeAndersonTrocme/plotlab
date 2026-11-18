import { defineStep, type GeoFeature, type GeometryLayer, type LayerValues, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/** Ink density of each pixel, 0..1: tone as-is; a level is its band's middle tone (0 = no ink). */
function darkness(v: LayerValues): (i: number) => number {
  if (v.kind === "tone") return (i) => v.data[i]!;
  const mid = Array.from({ length: v.count + 1 }, (_, l) => {
    if (l === 0) return 0;
    const b = v.bands?.[l - 1];
    return b ? (b.lo + b.hi) / 2 : l / v.count;
  });
  return (i) => mid[v.data[i]!] ?? 0;
}

/**
 * Grid cells as polygons: the vector twin of Pixelate. The grid is anchored at the paper's
 * (0, 0), like Fill's lattices (ADR 0009 Fill), so every layer, and a Fill at the same
 * spacing, shares its lines. Cells cut by the picture's edge are clipped to it.
 */
export const cells = defineStep({
  id: "cells",
  version: 1,
  title: "Grid cells",
  summary: "Lay a grid over each layer and draw a square in every inked cell: as outlines, or sized by darkness.",
  input: "layers",
  output: "geometry",
  cost: "live",
  params: {
    mode: {
      type: "enum",
      label: "Squares",
      help: "Outlines: one full square per cell dark enough to pass the threshold. Sized by darkness: darker cells get bigger squares.",
      options: [
        { value: "outline", label: "Outline every inked cell" },
        { value: "scaled", label: "Sized by darkness" },
      ],
      default: "outline",
    },
    cellMm: { type: "number", label: "Cell size", help: "Width of each square cell on the paper.", min: 0.5, max: 50, step: 0.5, default: 5, unit: "mm" },
    threshold: { type: "number", label: "Leave lighter cells empty", help: "Cells at or below this ink density get no square.", min: 0, max: 100, step: 1, default: 20, unit: "%" },
    minSize: { type: "number", label: "Smallest square", help: "Square size for the lightest ink, as a share of the cell.", min: 0, max: 100, step: 1, default: 10, unit: "%", visibleWhen: { param: "mode", equals: ["scaled"] } },
    maxSize: { type: "number", label: "Largest square", help: "Square size for full ink, as a share of the cell.", min: 0, max: 100, step: 1, default: 100, unit: "%", visibleWhen: { param: "mode", equals: ["scaled"] } },
    gap: { type: "number", label: "Gap", help: "Space left between neighbouring squares.", min: 0, max: 10, step: 0.1, default: 0, unit: "mm" },
    rotate: { type: "number", label: "Rotate", help: "Turn every square about its cell's centre (45° makes diamonds).", min: 0, max: 90, step: 1, default: 0, unit: "deg" },
  },
  help: help.cells ?? "",
  runLayer(layer, p, _ctx, grid): GeometryLayer {
    const { width: w, height: h, frame } = grid;
    const sx = frame.widthMm / w, sy = frame.heightMm / h;
    const c = Math.max(0.5, p.cellMm);
    const ink = darkness(layer.values);
    const x0 = frame.xMm, y0 = frame.yMm, x1 = x0 + frame.widthMm, y1 = y0 + frame.heightMm;
    // Pixel columns/rows whose centres fall in [a, b) mm.
    const span = (a: number, b: number, origin: number, s: number, n: number) => [Math.max(0, Math.ceil((a - origin) / s - 0.5)), Math.min(n, Math.ceil((b - origin) / s - 0.5))] as const;
    const a = (p.rotate * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const features: GeoFeature[] = [];
    for (let row = Math.floor(y0 / c); row * c < y1; row++) {
      const top = Math.max(y0, row * c), bottom = Math.min(y1, (row + 1) * c);
      const [py0, py1] = span(top, bottom, y0, sy, h);
      for (let col = Math.floor(x0 / c); col * c < x1; col++) {
        const left = Math.max(x0, col * c), right = Math.min(x1, (col + 1) * c);
        const [px0, px1] = span(left, right, x0, sx, w);
        if (px1 <= px0 || py1 <= py0) continue;
        let sum = 0;
        for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) sum += ink(y * w + x);
        const tone = sum / ((px1 - px0) * (py1 - py0));
        if (!(tone > p.threshold / 100)) continue;
        const f = p.mode === "scaled" ? (p.minSize + ((p.maxSize - p.minSize) * tone)) / 100 : 1;
        // Outlines trace the (possibly clipped) cell; sized squares stay square, fitting a clipped cell.
        let cw = right - left, ch = bottom - top;
        if (p.mode === "scaled") cw = ch = Math.min(cw, ch);
        const hw = (Math.max(0, cw - p.gap) * f) / 2, hh = (Math.max(0, ch - p.gap) * f) / 2;
        if (hw <= 0 || hh <= 0) continue;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const ring: Position[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => [cx + dx! * cos - dy! * sin, cy + dx! * sin + dy! * cos]);
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] }, properties: { tone, col, row } });
      }
    }
    return { id: layer.id, name: layer.name, features: { type: "FeatureCollection", features } };
  },
});
