import { defineStep, type GeoFeature, type GeometryLayer, type LayerValues, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";
import { gridSpans, offsetParam, type GridSpan } from "./grid.ts";

/**
 * Ink density of a cell from the pixels it covers, 0..1. Tone is averaged. Levels take the
 * cell's most common band (as Pixelate does), read as that band's middle tone (0 = no ink),
 * so squares come in one size per band.
 */
function cellInk(v: LayerValues): (idx: number[]) => number {
  if (v.kind === "tone") return (idx) => idx.reduce((s, i) => s + v.data[i]!, 0) / idx.length;
  const mid = Array.from({ length: v.count + 1 }, (_, l) => {
    if (l === 0) return 0;
    const b = v.bands?.[l - 1];
    return b ? (b.lo + b.hi) / 2 : l / v.count;
  });
  const counts = new Uint32Array(v.count + 1);
  return (idx) => {
    counts.fill(0);
    for (const i of idx) counts[v.data[i]!]!++;
    let best = 0;
    for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
    return mid[best] ?? 0;
  };
}

/**
 * Grid cells as polygons: the vector twin of Pixelate. The grid is anchored at the paper's
 * (0, 0), like Fill's lattices (ADR 0009 Fill), so every layer, and a Fill at the same
 * spacing, shares its lines; Pixelate uses the same grid (./grid.ts), and the offsets move it. Cells cut by the picture's edge are clipped to it; cut to under
 * a quarter of a cell, they are skipped.
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
    offsetX: offsetParam("x"),
    offsetY: offsetParam("y"),
  },
  help: help.cells ?? "",
  runLayer(layer, p, _ctx, grid): GeometryLayer {
    const { width: w, height: h, frame } = grid;
    const sx = frame.widthMm / w, sy = frame.heightMm / h;
    const c = Math.max(0.5, p.cellMm);
    const ink = cellInk(layer.values);
    // Pixels a cell reads: those whose centres it holds; a cell narrower than a pixel that
    // holds no centre takes the pixel under its middle.
    const pixels = (sp: GridSpan, origin: number, s: number, n: number): [number, number] => {
      if (sp.hi > sp.lo) return [sp.lo, sp.hi];
      const k = Math.min(n - 1, Math.max(0, Math.floor(((sp.a + sp.b) / 2 - origin) / s)));
      return [k, k + 1];
    };
    const a = (p.rotate * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const ac = Math.abs(cos), as = Math.abs(sin);
    // Cells cut by the picture's edge to under this are slivers, not drawn.
    const minCut = c / 4 - 1e-9;
    const idx: number[] = [];
    const features: GeoFeature[] = [];
    const rows = gridSpans(frame.yMm, frame.heightMm, h, c, p.offsetY);
    const cols = gridSpans(frame.xMm, frame.widthMm, w, c, p.offsetX);
    for (const rs of rows) {
      const { k: row, a: top, b: bottom } = rs;
      if (bottom - top < minCut) continue;
      const [py0, py1] = pixels(rs, frame.yMm, sy, h);
      for (const cs of cols) {
        const { k: col, a: left, b: right } = cs;
        if (right - left < minCut) continue;
        const [px0, px1] = pixels(cs, frame.xMm, sx, w);
        idx.length = 0;
        for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) idx.push(y * w + x);
        const tone = ink(idx);
        if (!(tone > p.threshold / 100)) continue;
        const f = p.mode === "scaled" ? (p.minSize + ((p.maxSize - p.minSize) * tone)) / 100 : 1;
        // Room for the shape: the (possibly clipped) cell minus the gap. Outlines fill it;
        // sized squares stay square.
        let cw = Math.max(0, right - left - p.gap), ch = Math.max(0, bottom - top - p.gap);
        if (p.mode === "scaled") cw = ch = Math.min(cw, ch);
        let hw = (cw * f) / 2, hh = (ch * f) / 2;
        if (hw <= 0 || hh <= 0) continue;
        // A turned shape is shrunk until its footprint fits the room again.
        const k = Math.min(1, cw / 2 / (hw * ac + hh * as), ch / 2 / (hw * as + hh * ac));
        hw *= k;
        hh *= k;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const ring: Position[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => [cx + dx! * cos - dy! * sin, cy + dx! * sin + dy! * cos]);
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] }, properties: { tone, col, row } });
      }
    }
    return { id: layer.id, name: layer.name, features: { type: "FeatureCollection", features } };
  },
});
