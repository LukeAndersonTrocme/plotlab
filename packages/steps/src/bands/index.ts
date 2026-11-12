import { defineStep, type GeoFeature, type GeometryLayer, type Position } from "@plotlab/engine";
import { simplify } from "../centerline/index.ts";
import { help } from "../help.generated.ts";
import { maskContours, maskPolygons } from "./trace.ts";

export const bands = defineStep({
  id: "bands",
  version: 1,
  title: "Bands",
  summary: "Turn each level into shapes (with real holes) that can be filled, or into contour lines.",
  input: "layers",
  output: "geometry",
  cost: "live",
  accepts: ["categories"],
  params: {
    mode: {
      type: "enum",
      label: "Make",
      help: "Areas are shapes to fill in the next step. Contour lines draw only the borders between levels, like a map.",
      options: [
        { value: "areas", label: "Areas to fill" },
        { value: "contours", label: "Contour lines" },
      ],
      default: "areas",
    },
    simplify: { type: "number", label: "Simplify", help: "Straighten small wiggles along the edges.", min: 0, max: 2, step: 0.05, default: 0.2, unit: "mm" },
  },
  help: help.bands ?? "",
  runLayer(layer, p, _ctx, grid): GeometryLayer {
    if (layer.values.kind !== "categories") throw new Error("unreachable: bands accepts categories");
    const { width: w, height: h, frame } = grid;
    const sx = frame.widthMm / w, sy = frame.heightMm / h;
    const toMm = (pts: Position[]): Position[] => pts.map(([x, y]) => [frame.xMm + x * sx, frame.yMm + y * sy]);
    const v = layer.values;
    const features: GeoFeature[] = [];
    if (p.mode === "areas") {
      for (let level = 1; level <= v.count; level++) {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) mask[i] = v.data[i] === level ? 1 : 0;
        const range = v.bands?.[level - 1];
        for (const poly of maskPolygons(mask, w, h)) {
          const rings = poly
            .map((r) => {
              const mm = toMm(r);
              const s = simplify([...mm, mm[0]!], p.simplify);
              return s.slice(0, -1);
            })
            .filter((r) => r.length >= 3);
          if (rings.length === 0) continue;
          features.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: rings },
            properties: { level, ...(range ? { toneLo: range.lo, toneHi: range.hi } : {}) },
          });
        }
      }
    } else {
      for (let level = 1; level < v.count; level++) {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) mask[i] = v.data[i]! > level ? 1 : 0;
        for (const line of maskContours(mask, w, h)) {
          const s = simplify(toMm(line), p.simplify);
          if (s.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: s }, properties: { level } });
        }
      }
    }
    return { id: layer.id, name: layer.name, features: { type: "FeatureCollection", features } };
  },
});
