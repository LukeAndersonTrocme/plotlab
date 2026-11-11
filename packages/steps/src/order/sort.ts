import type { Position } from "@plotlab/engine";

/**
 * Stroke ordering (ADR 0011): greedy nearest neighbour over a uniform grid of stroke
 * endpoints, then a windowed 2-opt pass. Pen starts at the origin [0, 0].
 */

/** Pen-up distance from the origin through every stroke in order (no return home). */
export function travelLength(paths: Position[][]): number {
  let at: Position = [0, 0], s = 0;
  for (const p of paths) {
    if (!p.length) continue;
    s += Math.hypot(p[0]![0] - at[0], p[0]![1] - at[1]);
    at = p[p.length - 1]!;
  }
  return s;
}

/** How far the 2-opt looks ahead, and how many sweeps it makes at most. */
const WINDOW = 64;
const SWEEPS = 3;

export function orderPaths(paths: Position[][], opts: { allowReverse: boolean; improve: boolean }): Position[][] {
  const strokes = paths.filter((p) => p.length > 0);
  const n = strokes.length;
  if (n === 0) return [];
  const sx = new Float64Array(n), sy = new Float64Array(n), ex = new Float64Array(n), ey = new Float64Array(n);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  strokes.forEach((p, i) => {
    const a = p[0]!, b = p[p.length - 1]!;
    sx[i] = a[0]; sy[i] = a[1]; ex[i] = b[0]; ey[i] = b[1];
    minX = Math.min(minX, a[0], b[0]); maxX = Math.max(maxX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
  });

  // Grid of endpoint entries: entry = stroke * 2 + (1 if it's the end point).
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const cell = Math.max(Math.sqrt((w * h) / n), 1e-6);
  const gw = Math.max(1, Math.ceil(w / cell) + 1), gh = Math.max(1, Math.ceil(h / cell) + 1);
  const cells: number[][] = Array.from({ length: gw * gh }, () => []);
  const cx = (x: number) => Math.floor((x - minX) / cell), cy = (y: number) => Math.floor((y - minY) / cell);
  for (let i = 0; i < n; i++) {
    cells[cy(sy[i]!) * gw + cx(sx[i]!)]!.push(i * 2);
    if (opts.allowReverse) cells[cy(ey[i]!) * gw + cx(ex[i]!)]!.push(i * 2 + 1);
  }

  const used = new Uint8Array(n);
  const order = new Int32Array(n);
  const flip = new Uint8Array(n);
  let atX = 0, atY = 0;
  for (let k = 0; k < n; k++) {
    const ax = cx(atX), ay = cy(atY);
    const maxR = Math.max(ax, gw - 1 - ax, ay, gh - 1 - ay, 0);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let y = ay - r; y <= ay + r; y++) {
        if (y < 0 || y >= gh) continue;
        const edge = y === ay - r || y === ay + r;
        for (let x = ax - r; x <= ax + r; x += edge ? 1 : 2 * r || 1) {
          if (x < 0 || x >= gw) continue;
          const list = cells[y * gw + x]!;
          for (let j = 0; j < list.length; j++) {
            const e = list[j]!, s = e >> 1;
            if (used[s]) {
              // Drop spent entries as we meet them so cells stay short.
              list[j] = list[list.length - 1]!;
              list.pop();
              j--;
              continue;
            }
            const px = e & 1 ? ex[s]! : sx[s]!, py = e & 1 ? ey[s]! : sy[s]!;
            const d = (px - atX) ** 2 + (py - atY) ** 2;
            if (d < bestD) { bestD = d; best = e; }
          }
        }
      }
      // Anything in ring r+1 is at least r cells away.
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) break;
    }
    const s = best >> 1;
    used[s] = 1;
    order[k] = s;
    flip[k] = best & 1;
    atX = flip[k] ? sx[s]! : ex[s]!;
    atY = flip[k] ? sy[s]! : ey[s]!;
  }

  if (opts.improve && opts.allowReverse && n > 2) twoOpt(order, flip, sx, sy, ex, ey);

  const out: Position[][] = new Array(n);
  for (let k = 0; k < n; k++) {
    const p = strokes[order[k]!]!;
    out[k] = flip[k] ? [...p].reverse() : p;
  }
  return out;
}

/**
 * Windowed 2-opt over the stroke sequence. Reversing positions i+1..j also flips each
 * stroke in that run, so it only applies when strokes may be reversed.
 */
function twoOpt(
  order: Int32Array,
  flip: Uint8Array,
  sx: Float64Array,
  sy: Float64Array,
  ex: Float64Array,
  ey: Float64Array,
): void {
  const n = order.length;
  // Entry point (a) and exit point (b) of the stroke at position k, honouring flips.
  const ax = (k: number) => (flip[k] ? ex : sx)[order[k]!]!, ay = (k: number) => (flip[k] ? ey : sy)[order[k]!]!;
  const bx = (k: number) => (k < 0 ? 0 : (flip[k] ? sx : ex)[order[k]!]!), by = (k: number) => (k < 0 ? 0 : (flip[k] ? sy : ey)[order[k]!]!);
  const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let improved = false;
    for (let i = -1; i < n - 2; i++) {
      const bix = bx(i), biy = by(i);
      const a1x = ax(i + 1), a1y = ay(i + 1);
      const before1 = dist(bix, biy, a1x, a1y);
      for (let j = i + 2; j < Math.min(n, i + 2 + WINDOW); j++) {
        const bjx = bx(j), bjy = by(j);
        const last = j === n - 1;
        const before = before1 + (last ? 0 : dist(bjx, bjy, ax(j + 1), ay(j + 1)));
        const after = dist(bix, biy, bjx, bjy) + (last ? 0 : dist(a1x, a1y, ax(j + 1), ay(j + 1)));
        if (after < before - 1e-9) {
          // Reverse positions i+1..j and flip each stroke in the run.
          for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) {
            const o = order[lo]!; order[lo] = order[hi]!; order[hi] = o;
            const f = flip[lo]!; flip[lo] = flip[hi]!; flip[hi] = f;
          }
          for (let k = i + 1; k <= j; k++) flip[k] = flip[k] ? 0 : 1;
          improved = true;
          break; // position i+1 changed; move on
        }
      }
    }
    if (!improved) break;
  }
}
