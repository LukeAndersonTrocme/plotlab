import type { Position } from "@plotlab/engine";

/**
 * Marching squares on a 0/1 mask (ADR 0009 Bands). Coordinates are in pixels with pixel
 * (x, y)'s centre at (x + 0.5, y + 0.5). The mask is padded with 0 so shapes touching the
 * edge still close; diagonal-only contacts stay separate shapes ("saddle = separate").
 */

type Edge = "t" | "r" | "b" | "l";
// Segments per cell case (tl·8 + tr·4 + br·2 + bl·1).
const CASES: Edge[][][] = [
  [], [["l", "b"]], [["b", "r"]], [["l", "r"]], [["t", "r"]], [["t", "r"], ["l", "b"]], [["t", "b"]], [["l", "t"]],
  [["l", "t"]], [["t", "b"]], [["l", "t"], ["b", "r"]], [["t", "r"]], [["l", "r"]], [["b", "r"]], [["l", "b"]], [],
];
// The corner two adjacent edges share (the corner the segment cuts off).
const SHARED: Record<string, "tl" | "tr" | "br" | "bl"> = { lt: "tl", tl: "tl", tr: "tr", rt: "tr", rb: "br", br: "br", bl: "bl", lb: "bl" };

interface Seg {
  a: Position;
  b: Position;
  border: boolean;
}

function segments(mask: Uint8Array, w: number, h: number): Seg[] {
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]! ? 1 : 0);
  const out: Seg[] = [];
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;
      const mid: Record<Edge, Position> = { t: [i + 1, j + 0.5], r: [i + 1.5, j + 1], b: [i + 1, j + 1.5], l: [i + 0.5, j + 1] };
      const corner = { tl: [i + 0.5, j + 0.5], tr: [i + 1.5, j + 0.5], br: [i + 1.5, j + 1.5], bl: [i + 0.5, j + 1.5] } as const;
      const inside = { tl, tr, br, bl };
      for (const [e1, e2] of CASES[c]!) {
        let a = mid[e1!], b = mid[e2!];
        // Orient every segment so the inside is on its right (y down): outer rings come out
        // with positive shoelace area, holes negative.
        const ref = SHARED[e1! + e2!] ?? "tl";
        const p = corner[ref];
        const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if ((cross > 0) !== (inside[ref] === 1)) [a, b] = [b, a];
        out.push({ a, b, border: i < 0 || j < 0 || i >= w - 1 || j >= h - 1 });
      }
    }
  }
  return out;
}

const key = (p: Position) => `${p[0]},${p[1]}`;

/** Chain oriented segments: open chains first (from starts nothing ends at), then loops. */
function chain(segs: Seg[]): Array<{ pts: Position[]; closed: boolean }> {
  const byStart = new Map<string, number>();
  const ends = new Set<string>();
  segs.forEach((s, i) => {
    byStart.set(key(s.a), i);
    ends.add(key(s.b));
  });
  const used = new Uint8Array(segs.length);
  const out: Array<{ pts: Position[]; closed: boolean }> = [];
  const walk = (i: number) => {
    const pts: Position[] = [segs[i]!.a];
    let cur: number | undefined = i;
    while (cur !== undefined && !used[cur]) {
      used[cur] = 1;
      pts.push(segs[cur]!.b);
      cur = byStart.get(key(segs[cur]!.b));
    }
    const closed = key(pts[0]!) === key(pts[pts.length - 1]!);
    out.push({ pts: closed ? pts.slice(0, -1) : pts, closed });
  };
  segs.forEach((s, i) => !used[i] && !ends.has(key(s.a)) && walk(i));
  segs.forEach((_, i) => !used[i] && walk(i));
  return out;
}

/** Signed shoelace area. Positive = outer ring as traced here. */
export function ringArea(r: Position[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]!, [x2, y2] = r[(i + 1) % r.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInRing(p: Position, r: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shapes of the mask as polygons: [outer, ...holes], in pixel coordinates. */
export function maskPolygons(mask: Uint8Array, w: number, h: number): Position[][][] {
  const rings = chain(segments(mask, w, h)).filter((c) => c.closed && c.pts.length > 2).map((c) => c.pts);
  const outers: Array<{ ring: Position[]; area: number; box: [number, number, number, number]; holes: Position[][] }> = [];
  const holes: Position[][] = [];
  for (const r of rings) {
    const a = ringArea(r);
    if (a > 0) {
      const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
      outers.push({ ring: r, area: a, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], holes: [] });
    } else holes.push(r);
  }
  for (const hole of holes) {
    const p = hole[0]!;
    let best: (typeof outers)[number] | undefined;
    for (const o of outers) {
      if (p[0] < o.box[0] || p[0] > o.box[2] || p[1] < o.box[1] || p[1] > o.box[3]) continue;
      if ((!best || o.area < best.area) && pointInRing(p, o.ring)) best = o;
    }
    best?.holes.push(hole);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

/** Iso-lines of the mask inside the image (nothing traced along the image border). */
export function maskContours(mask: Uint8Array, w: number, h: number): Position[][] {
  return chain(segments(mask, w, h).filter((s) => !s.border)).map((c) => (c.closed ? [...c.pts, c.pts[0]!] : c.pts));
}
