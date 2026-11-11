import { defineStep, toPlot, type Plot } from "@plotlab/engine";
import { orderPaths } from "./sort.ts";

export { orderPaths, travelLength } from "./sort.ts";
import { help } from "../help.generated.ts";

export const order = defineStep({
  id: "order",
  version: 2,
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
    improve: {
      type: "boolean",
      label: "Polish the order",
      help: "After nearest-first, look for runs of strokes that are shorter to draw backwards (2-opt). Needs reversing allowed.",
      default: true,
      visibleWhen: { param: "method", equals: ["nearest"] },
    },
  },
  help: help.order ?? "",
  run(geo, p, ctx): Plot {
    const paths = geo.layers.map((l) => {
      const ps = l.features.features.map((f) => f.geometry.coordinates);
      return p.method === "nearest" ? orderPaths(ps, { allowReverse: p.allowReverse, improve: p.improve }) : ps;
    });
    return toPlot(geo, ctx, paths);
  },
  migrate: (params) => ({ params, note: "Adds 'Polish the order' (2-opt), on by default." }),
});
