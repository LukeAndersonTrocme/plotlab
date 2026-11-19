import type { NumberParam } from "@plotlab/engine";

/**
 * The square grid that Grid cells and Pixelate share. Its lines sit at `offset + k · cell` mm
 * on the paper (k any integer), so with no offset the grid starts at the paper's (0, 0), like
 * Fill's lattices (ADR 0009 Fill), and both steps at the same cell size and offsets give the
 * same cells whatever the picture's position.
 */

/**
 * A grid offset along one axis. A whole cell's shift gives the same grid, so ±25 mm covers
 * every position of the grid for every cell size up to the 50 mm maximum; 0.1 mm steps match
 * Grid cells' gap.
 */
export function offsetParam(axis: "x" | "y"): NumberParam {
  return {
    type: "number",
    label: axis === "x" ? "Shift grid across" : "Shift grid down",
    help: axis === "x" ? "Move the grid's lines right (or left, below 0) from the paper's left edge." : "Move the grid's lines down (or up, below 0) from the paper's top edge.",
    min: -25,
    max: 25,
    step: 0.1,
    default: 0,
    unit: "mm",
  };
}

/** One column (or row) of the grid as it falls on the picture. */
export interface GridSpan {
  /** Index of the cell on the paper's grid. */
  k: number;
  /** The cell's extent in mm, clipped to the picture. */
  a: number;
  b: number;
  /** Pixels whose centres fall in [a, b); empty (lo === hi) for a cell narrower than a pixel that holds no centre. */
  lo: number;
  hi: number;
}

/**
 * The grid's cells along one axis of a picture that starts at `start` mm, is `size` mm long and
 * `n` pixels wide. Each pixel belongs to exactly one span.
 */
export function gridSpans(start: number, size: number, n: number, cell: number, offset: number): GridSpan[] {
  const end = start + size, s = size / n;
  const px = (mm: number) => Math.min(n, Math.max(0, Math.ceil((mm - start) / s - 0.5)));
  const spans: GridSpan[] = [];
  for (let k = Math.floor((start - offset) / cell); offset + k * cell < end; k++) {
    const a = Math.max(start, offset + k * cell), b = Math.min(end, offset + (k + 1) * cell);
    if (b <= a) continue;
    spans.push({ k, a, b, lo: px(a), hi: px(b) });
  }
  return spans;
}
