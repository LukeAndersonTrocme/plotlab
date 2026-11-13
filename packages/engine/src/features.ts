import type { GeoFeature, Position } from "./types.ts";

/** The strokes a feature draws: a line as-is, a polygon as each of its rings, closed. */
export function featurePaths(f: GeoFeature): Position[][] {
  if (f.geometry.type === "LineString") return [f.geometry.coordinates];
  return f.geometry.coordinates
    .filter((r) => r.length > 1)
    .map((r) => {
      const a = r[0]!, b = r[r.length - 1]!;
      return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
    });
}
