import type { Position } from "@plotlab/engine";

/**
 * Lattices clipped to polygons (ADR 0009 Fill). Every lattice is anchored at the paper's
 * (0, 0), so shapes filled with the same spacing and angle line up across the page.
 * Clipping is by even-odd scanlines, so holes stay empty and concave shapes work.
 */

/** Below this, a slider at 0 would ask for millions of lines. */
export const MIN_SPACING = 0.1;

/** For each lattice row k (v = k·spacing in the rotated frame), the inside [u0, u1] intervals. */
function rows(rings: Position[][], spacing: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const toU = (p: Position) => p[0] * c + p[1] * s;
  const toV = (p: Position) => -p[0] * s + p[1] * c;
  const hits = new Map<number, number[]>();
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!, q = r[(i + 1) % r.length]!;
      const v1 = toV(p), v2 = toV(q);
      if (v1 === v2) continue;
      const lo = Math.min(v1, v2), hi = Math.max(v1, v2);
      // Half-open [lo, hi) so a vertex shared by two edges counts once.
      for (let k = Math.ceil(lo / spacing); k * spacing < hi; k++) {
        const v = k * spacing;
        const t = (v - v1) / (v2 - v1);
        const u = toU(p) + t * (toU(q) - toU(p));
        let list = hits.get(k);
        if (!list) hits.set(k, (list = []));
        list.push(u);
      }
    }
  }
  const back = (u: number, v: number): Position => [u * c - v * s, u * s + v * c];
  const out: Array<{ v: number; spans: Array<[number, number]> }> = [];
  for (const k of [...hits.keys()].sort((x, y) => x - y)) {
    const us = hits.get(k)!.sort((x, y) => x - y);
    const spans: Array<[number, number]> = [];
    for (let i = 0; i + 1 < us.length; i += 2) if (us[i + 1]! > us[i]!) spans.push([us[i]!, us[i + 1]!]);
    out.push({ v: k * spacing, spans });
  }
  return { rows: out, back };
}

/** Parallel lines at `spacing` mm, `angleDeg` from horizontal, clipped to the rings. */
export function hatch(rings: Position[][], spacing: number, angleDeg: number): Position[][] {
  const sp = Math.max(MIN_SPACING, spacing);
  const { rows: rs, back } = rows(rings, sp, angleDeg);
  const out: Position[][] = [];
  for (const { v, spans } of rs) for (const [u0, u1] of spans) out.push([back(u0, v), back(u1, v)]);
  return out;
}

/**
 * Dots on a square lattice inside the rings. Dots wider than a fine pen are drawn as small
 * closed circles; smaller ones are a single pen touch ([p, p]).
 */
export function dots(rings: Position[][], spacing: number, angleDeg: number, radiusMm: number): Position[][] {
  const sp = Math.max(MIN_SPACING, spacing);
  const { rows: rs, back } = rows(rings, sp, angleDeg);
  const out: Position[][] = [];
  for (const { v, spans } of rs) {
    for (const [u0, u1] of spans) {
      for (let m = Math.ceil(u0 / sp); m * sp <= u1; m++) {
        const p = back(m * sp, v);
        if (radiusMm <= 0.15) out.push([p, p]);
        else {
          const ring: Position[] = [];
          for (let j = 0; j <= 8; j++) {
            const t = (j % 8) * (Math.PI / 4);
            ring.push([p[0] + radiusMm * Math.cos(t), p[1] + radiusMm * Math.sin(t)]);
          }
          out.push(ring);
        }
      }
    }
  }
  return out;
}
