import { defineStep, toPlot, type Plot, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";

const d2 = (a: Position, b: Position) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Greedy nearest-neighbour ordering, optionally reversing strokes. O(n²). */
export function orderPaths(paths: Position[][], allowReverse: boolean): Position[][] {
  const left = paths.filter((p) => p.length > 0);
  const out: Position[][] = [];
  let at: Position = [0, 0];
  while (left.length) {
    let best = 0, bestD = Infinity, rev = false;
    for (let i = 0; i < left.length; i++) {
      const p = left[i]!;
      const ds = d2(at, p[0]!);
      if (ds < bestD) { bestD = ds; best = i; rev = false; }
      if (allowReverse) {
        const de = d2(at, p[p.length - 1]!);
        if (de < bestD) { bestD = de; best = i; rev = true; }
      }
    }
    const [p] = left.splice(best, 1);
    const q = rev ? [...p!].reverse() : p!;
    out.push(q);
    at = q[q.length - 1]!;
  }
  return out;
}

export const order = defineStep({
  id: "order",
  version: 1,
  title: "Stroke order",
  summary: "Order each pass's strokes so the pen travels less between them.",
  input: "geometry",
  output: "plot",
  cost: "on-demand",
  params: {
    method: {
      type: "enum",
      label: "Order",
      help: "Nearest-first saves travel. 'As traced' keeps the order the strokes were made.",
      options: [
        { value: "nearest", label: "Nearest first" },
        { value: "as-traced", label: "As traced" },
      ],
      default: "nearest",
    },
    allowReverse: {
      type: "boolean",
      label: "Allow reversing strokes",
      help: "Let the pen draw a stroke from either end if that's closer.",
      default: true,
      visibleWhen: { param: "method", equals: ["nearest"] },
    },
  },
  help: help.order ?? "",
  run(geo, p, ctx): Plot {
    const paths = geo.layers.map((l) => {
      const ps = l.features.features.map((f) => f.geometry.coordinates);
      return p.method === "nearest" ? orderPaths(ps, p.allowReverse) : ps;
    });
    return toPlot(geo, ctx, paths);
  },
});
