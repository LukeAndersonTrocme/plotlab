import { defineStep, type Plot, type PlotLayer, type Position } from "@plotlab/engine";
import { estimateLayer, getMachine } from "@plotlab/machines";
import { help } from "../help.generated.ts";

const d2 = (a: Position, b: Position) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Greedy nearest-neighbour ordering, optionally reversing strokes. O(n²); fine for a first slice. */
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

export const plot = defineStep({
  id: "plot",
  version: 1,
  title: "Place on paper",
  summary: "Fit the drawing onto the paper, order the strokes to save pen-up travel, and estimate plot time.",
  input: "geometry",
  output: "plot",
  cost: "live",
  params: {
    margin: {
      type: "number",
      label: "Margin",
      help: "Blank border around the drawing.",
      min: 0,
      max: 100,
      step: 1,
      default: 15,
      unit: "mm",
    },
    order: {
      type: "enum",
      label: "Stroke order",
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
      visibleWhen: { param: "order", equals: ["nearest"] },
    },
  },
  help: help.plot ?? "",
  run(geo, p, ctx): Plot {
    const machine = getMachine(ctx.machine);
    const { widthMm: pw, heightMm: ph } = ctx.paper;
    const aw = Math.max(1, pw - 2 * p.margin), ah = Math.max(1, ph - 2 * p.margin);
    const s = Math.min(aw / geo.extent.width, ah / geo.extent.height);
    const ox = (pw - geo.extent.width * s) / 2, oy = (ph - geo.extent.height * s) / 2;
    const layers: PlotLayer[] = geo.layers.map((l) => {
      const pen = ctx.pens.find((x) => x.id === l.pen) ?? ctx.pens[0] ?? { id: l.pen, widthMm: 0.5, color: "#000" };
      let paths: Position[][] = l.features.features.map((f) =>
        f.geometry.coordinates.map(([x, y]): Position => [ox + x * s, oy + y * s]),
      );
      if (p.order === "nearest") paths = orderPaths(paths, p.allowReverse);
      const e = estimateLayer(paths, machine);
      return { id: l.id, name: l.name, pen, paths, drawLengthMm: e.drawLengthMm, travelLengthMm: e.travelLengthMm, timeEstimateS: e.timeS };
    });
    const total = layers.reduce((t, l) => t + l.timeEstimateS, 0) + Math.max(0, layers.length - 1) * machine.pen.changeS;
    return { kind: "plot", paper: ctx.paper, layers, timeEstimateS: total, machine: machine.id };
  },
});
