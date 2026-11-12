/**
 * Typed stage data. Every step declares which of these it consumes and produces.
 * See GLOSSARY.md for the canonical terms.
 *
 * Coordinates (ADR 0005): the source is placed on the paper before any step runs.
 * Rasters carry a `Frame` (their rectangle on the paper, in mm); geometry and plots
 * are in paper mm, top-left origin, y down. A low-res proxy has fewer pixels but the
 * same frame, so it lands in the same place.
 */

export interface Paper {
  widthMm: number;
  heightMm: number;
}

/** Where a raster sits on the paper, in mm. Pixel (0,0)'s top-left corner is at (xMm, yMm). */
export interface Frame {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** Decoded pixels before they are placed on paper (what file readers return). */
export interface RawImage {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  /** Row-major, interleaved channels, 0..1 (0 = black). */
  data: Float32Array;
}

/** A raster on the paper: a grid of pixels with one or more channels (the Z-axis). */
export interface Image extends RawImage {
  kind: "image";
  frame: Frame;
}

/** A layer value is ink density (tone, 0..1) or a label (categories, 1..count; 0 = no ink). */
export type LayerValueKind = "tone" | "categories";
export type LayerValues =
  | { kind: "tone"; data: Float32Array }
  | {
      kind: "categories";
      data: Uint16Array;
      count: number;
      /** Tone range of each label (index 0 = label 1), when the labels came from cutting tone. */
      bands?: Array<{ lo: number; hi: number }>;
    };

/** One ink pass/plate (ADR 0009). The ink is assigned by the recipe's `layerInks`. */
export interface Layer {
  id: string;
  name: string;
  values: LayerValues;
}

/** Layers share one pixel grid laid over `frame`. */
export interface Layers {
  kind: "layers";
  width: number;
  height: number;
  frame: Frame;
  layers: Layer[];
}

/** A position, GeoJSON order: [x, y], in paper mm. */
export type Position = [number, number];

/** GeoJSON-compatible line feature. */
export interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] };
  properties: Record<string, unknown>;
}

/** GeoJSON polygon: first ring is the outline, the rest are holes. Rings need not repeat their first point. */
export interface PolygonFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Position[][] };
  properties: Record<string, unknown>;
}

export type GeoFeature = LineFeature | PolygonFeature;

export interface GeometryLayer {
  id: string;
  name: string;
  /** GeoJSON FeatureCollection, so geometry can round-trip to R/QGIS. */
  features: { type: "FeatureCollection"; features: GeoFeature[] };
}

export interface Geometry {
  kind: "geometry";
  paper: Paper;
  layers: GeometryLayer[];
  /** Layers whose chain stopped before becoming lines (ADR 0009). Digital targets still show them. */
  rasterLayers?: Layers;
}

/** A layer's colour, how it mixes with the layers under it, and its stroke width (ADR 0008). */
export interface Ink {
  id: string;
  name: string;
  color: string;
  mix: "multiply" | "normal";
  widthMm: number;
}

/** One pass of the plot: one ink's ordered strokes. */
export interface PlotLayer {
  id: string;
  name: string;
  ink: Ink;
  paths: Position[][];
}

/**
 * Lines on paper, one layer per pass, in pass order. Machine-agnostic: time comes
 * from `estimatePlot(plot, machine)` in @plotlab/machines.
 */
export interface Plot {
  kind: "plot";
  paper: Paper;
  layers: PlotLayer[];
  /** False while strokes are still in traced order (no Stroke order step yet). */
  ordered: boolean;
  rasterLayers?: Layers;
}

export type StageData = Image | Layers | Geometry | Plot;
export type StageKind = StageData["kind"];

export type StageDataOf<K extends StageKind> = Extract<StageData, { kind: K }>;
