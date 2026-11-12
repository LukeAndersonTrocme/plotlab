import { defineStep, type GeoFeature, type Geometry, type Position } from "@plotlab/engine";
import { help } from "../help.generated.ts";
import { dots, hatch } from "./lattice.ts";

export interface FillParams {
  kind: string;
  mapping: string;
  minSpacing: number;
  maxSpacing: number;
  angle: number;
  angleSpread: number;
  dotSize: number;
  overrides: Record<string, Record<string, number>>;
  cumulative: boolean;
  skipLightest: boolean;
  outline: boolean;
}

const CYCLE = [0, 90, 45, 135];

/**
 * The pattern for one band. Continuous: spacing shrinks and the angle turns as the band
 * gets darker. Cycle (the old R prototype): horizontal, vertical, then the two diagonals,
 * getting denser band by band. A per-band override wins over both.
 */
export function bandPattern(level: number, tone: number, count: number, p: FillParams): { spacing: number; angle: number } {
  const first = p.skipLightest ? 2 : 1;
  const inked = Math.max(1, count - first + 1);
  const idx = Math.max(0, level - first);
  let spacing: number, angle: number;
  if (p.mapping === "cycle") {
    spacing = p.maxSpacing + ((p.minSpacing - p.maxSpacing) * idx) / Math.max(1, inked - 1);
    angle = (p.angle - 45 + CYCLE[idx % 4]!) % 180;
    if (angle < 0) angle += 180;
  } else {
    spacing = p.maxSpacing + (p.minSpacing - p.maxSpacing) * tone;
    angle = p.angle + p.angleSpread * tone;
  }
  const o = p.overrides[String(level)];
  return { spacing: o?.spacing ?? spacing, angle: o?.angle ?? angle };
}

const line = (coordinates: Position[], level: number): GeoFeature => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { level } });

export const fill = defineStep({
  id: "fill",
  version: 1,
  title: "Fill",
  summary: "Fill each band with lines or dots: darker bands get denser patterns.",
  input: "geometry",
  output: "geometry",
  cost: "live",
  params: {
    kind: {
      type: "enum",
      label: "Fill with",
      help: "Lines are hatching. Dots suit screen printing and letterpress.",
      options: [
        { value: "lines", label: "Lines (hatching)" },
        { value: "dots", label: "Dots" },
      ],
      default: "lines",
    },
    mapping: {
      type: "enum",
      label: "Pattern",
      help: "Smooth: spacing and angle change gradually with darkness. Cycle: each band switches direction (horizontal, vertical, diagonals) and gets denser.",
      options: [
        { value: "continuous", label: "Smooth with darkness" },
        { value: "cycle", label: "Cycle directions" },
      ],
      default: "continuous",
    },
    minSpacing: { type: "number", label: "Darkest spacing", help: "Distance between lines (or dots) in the darkest band.", min: 0.1, max: 10, step: 0.05, default: 0.6, unit: "mm" },
    maxSpacing: { type: "number", label: "Lightest spacing", help: "Distance between lines (or dots) in the lightest inked band.", min: 0.1, max: 20, step: 0.1, default: 3, unit: "mm" },
    angle: { type: "number", label: "Angle", help: "Direction of the lines.", min: 0, max: 180, step: 1, default: 45, unit: "deg" },
    angleSpread: {
      type: "number",
      label: "Turn with darkness",
      help: "How much the angle turns from the lightest to the darkest band.",
      min: 0,
      max: 180,
      step: 1,
      default: 0,
      unit: "deg",
      visibleWhen: { param: "mapping", equals: ["continuous"] },
    },
    dotSize: { type: "number", label: "Dot size", help: "Largest dot, in the darkest band. Lighter bands get smaller dots.", min: 0.1, max: 3, step: 0.05, default: 0.6, unit: "mm", visibleWhen: { param: "kind", equals: ["dots"] } },
    overrides: {
      type: "table",
      label: "Per-band settings",
      help: "Give one band its own spacing or angle. Bands are numbered from the lightest (1).",
      rowLabel: "Band",
      columns: { spacing: { label: "Spacing", min: 0.1, max: 20, step: 0.05, unit: "mm" }, angle: { label: "Angle", min: 0, max: 180, step: 1, unit: "deg" } },
      default: {},
    },
    cumulative: { type: "boolean", label: "Cross-hatch (cumulative)", help: "Darker bands also get the lighter bands' lines, so patterns build up like layered hatching.", default: false },
    skipLightest: { type: "boolean", label: "Leave the lightest band as paper", help: "No lines in band 1.", default: true },
    outline: { type: "boolean", label: "Draw band outlines", help: "Also draw the border of each band.", default: false },
  },
  help: help.fill ?? "",
  run(geo, p): Geometry {
    const params = p as unknown as FillParams;
    return {
      ...geo,
      layers: geo.layers.map((l) => {
        const polys = l.features.features.filter((f) => f.geometry.type === "Polygon");
        const count = polys.reduce((m, f) => Math.max(m, Number(f.properties.level) || 0), 0);
        const toneOf = (f: GeoFeature) => {
          const lo = Number(f.properties.toneLo), hi = Number(f.properties.toneHi);
          return Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : (Number(f.properties.level) || 1) / Math.max(1, count);
        };
        // The tone of each level, for cumulative fills that borrow lighter bands' patterns.
        const levelTone = new Map<number, number>();
        for (const f of polys) levelTone.set(Number(f.properties.level), toneOf(f));
        const out: GeoFeature[] = [];
        for (const f of l.features.features) {
          if (f.geometry.type !== "Polygon") {
            out.push(f);
            continue;
          }
          const level = Number(f.properties.level) || 1;
          if (params.outline) out.push(f);
          if (params.skipLightest && level <= 1) continue;
          const levelsToDraw = params.cumulative ? [...levelTone.keys()].filter((j) => j <= level && !(params.skipLightest && j <= 1)) : [level];
          for (const j of levelsToDraw) {
            const t = levelTone.get(j) ?? toneOf(f);
            const { spacing, angle } = bandPattern(j, t, count, params);
            const rings = f.geometry.coordinates;
            const paths = params.kind === "dots" ? dots(rings, spacing, angle, (params.dotSize / 2) * Math.sqrt(t)) : hatch(rings, spacing, angle);
            for (const path of paths) out.push(line(path, level));
          }
        }
        return { ...l, features: { type: "FeatureCollection" as const, features: out } };
      }),
    };
  },
});
