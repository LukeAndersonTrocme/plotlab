import { defineStep, pxToMm, type Frame, type GeometryLayer, type LineFeature, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";

/** Zhang–Suen thinning. Returns a new mask, 1 = skeleton. */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = mask[i]! > 0 ? 1 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]!);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!m[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          del.push(y * w + x);
        }
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

/**
 * Skeleton neighbours. A diagonal neighbour is skipped when an orthogonal pixel already
 * connects the two, which removes the little triangles that would look like junctions.
 */
function neighbours(m: Uint8Array, w: number, h: number, i: number): number[] {
  const x = i % w, y = (i - x) / w;
  const on = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx] === 1;
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (on(x + dx, y + dy)) out.push(i + dy * w + dx);
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) out.push(i + dy * w + dx);
  }
  return out;
}

/** Walk the skeleton graph into polylines of pixel indices. */
export function traceSkeleton(m: Uint8Array, w: number, h: number): number[][] {
  const n = w * h;
  const nb = new Map<number, number[]>();
  for (let i = 0; i < n; i++) if (m[i]) nb.set(i, neighbours(m, w, h, i));
  const seen = new Set<number>();
  const ek = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const paths: number[][] = [];
  const walk = (start: number, next: number) => {
    const path = [start, next];
    seen.add(ek(start, next));
    let prev = start, cur = next;
    while ((nb.get(cur)?.length ?? 0) === 2 && cur !== start) {
      const cand = nb.get(cur)!.find((c) => c !== prev && !seen.has(ek(cur, c)));
      if (cand === undefined) break;
      seen.add(ek(cur, cand));
      path.push(cand);
      prev = cur;
      cur = cand;
    }
    paths.push(path);
  };
  // Open paths start at endpoints and junctions.
  for (const [i, ns] of nb) {
    if (ns.length === 2) continue;
    for (const j of ns) if (!seen.has(ek(i, j))) walk(i, j);
  }
  // What's left are closed loops.
  for (const [i, ns] of nb) for (const j of ns) if (!seen.has(ek(i, j))) walk(i, j);
  // Isolated single pixels become dots.
  for (const [i, ns] of nb) if (ns.length === 0) paths.push([i, i]);
  return paths;
}

/** Ramer–Douglas–Peucker. */
export function simplify(pts: Position[], tol: number): Position[] {
  if (tol <= 0 || pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const length = (p: Position[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1]![0], q[1] - p[i - 1]![1]) : 0), 0);

/** Trace one 0/1 mask laid over `frame` into strokes in paper mm. */
export function centerlineMask(mask: Uint8Array, w: number, h: number, frame: Frame, minLengthMm: number, tolMm: number): LineFeature[] {
  const skel = thin(mask, w, h);
  const out: LineFeature[] = [];
  for (const ids of traceSkeleton(skel, w, h)) {
    let pts: Position[] = ids.map((i) => {
      const x = i % w;
      return pxToMm(frame, w, h, x, (i - x) / w);
    });
    pts = simplify(pts, tolMm);
    if (length(pts) < minLengthMm) continue; // also drops 1–2 pixel specks
    out.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} });
  }
  return out;
}

export const centerline = defineStep({
  id: "centerline",
  version: 2,
  title: "Centerline",
  summary: "Draw one stroke down the middle of each shape, like tracing it with a single pen line.",
  input: "layers",
  output: "geometry",
  cost: "live",
  params: {
    minLength: {
      type: "number",
      label: "Minimum length",
      help: "Drop strokes shorter than this. Cleans up specks and fuzz.",
      min: 0,
      max: 50,
      step: 0.1,
      default: 2,
      unit: "mm",
    },
    smoothing: {
      type: "number",
      label: "Simplify",
      help: "Straighten small wiggles. Higher = fewer, straighter segments.",
      min: 0,
      max: 5,
      step: 0.05,
      default: 0.2,
      unit: "mm",
    },
  },
  help: help.centerline ?? "",
  accepts: ["tone"],
  runLayer(layer, p, _ctx, grid): GeometryLayer {
    const n = grid.width * grid.height;
    const mask = new Uint8Array(n);
    const tone = layer.values.data;
    for (let i = 0; i < n; i++) mask[i] = tone[i]! >= 0.5 ? 1 : 0;
    return {
      id: layer.id,
      name: layer.name,
      features: { type: "FeatureCollection", features: centerlineMask(mask, grid.width, grid.height, grid.frame, p.minLength, p.smoothing) },
    };
  },
  migrate: (params) => ({
    params,
    note: "Minimum length and Simplify are now in mm on the paper (they were source pixels). Check the result.",
  }),
});
