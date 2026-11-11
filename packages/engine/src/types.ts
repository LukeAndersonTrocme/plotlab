/**
 * Typed stage data. Every step declares which of these it consumes and produces.
 * See GLOSSARY.md for the canonical terms.
 *
 * Coordinates: rasters carry an `extent` in *source units* (the pixel size of the
 * original Source). A low-res proxy has fewer pixels but the same extent, so geometry
 * traced from a proxy lands in the same place as geometry traced at full resolution.
 * The Plot step maps source units onto paper in mm.
 */

/** Width/height in source units (original Source pixels). */
export interface Extent {
  width: number;
  height: number;
}

/** A raster: a grid of pixels with one or more channels (the Z-axis). Values are 0..1. */
export interface Image {
  kind: "image";
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  /** Row-major, interleaved channels, 0..1 (0 = black / no ink density). */
  data: Float32Array;
  extent: Extent;
}

/** A pen: a tool with a width (mm) and a color, assigned to a layer. */
export interface Pen {
  id: string;
  widthMm: number;
  color: string;
}

/** One physical pen pass: a mask of where one pen goes. */
export interface Layer {
  id: string;
  name: string;
  /** Pen id from the recipe's pens. */
  pen: string;
  width: number;
  height: number;
  /** Row-major, 1 value per pixel. 0 = no ink; >0 = ink (1-bit uses 0/1; few-level masks use 1..levels-1). */
  mask: Uint8Array;
  levels: number;
}

export interface Layers {
  kind: "layers";
  layers: Layer[];
  extent: Extent;
}

/** A position, GeoJSON order: [x, y]. */
export type Position = [number, number];

/** GeoJSON-compatible line feature. Coordinates in source units (Geometry) or mm (Plot). */
export interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] };
  properties: Record<string, unknown>;
}

export interface GeometryLayer {
  id: string;
  name: string;
  pen: string;
  /** GeoJSON FeatureCollection, so geometry can round-trip to R/QGIS. */
  features: { type: "FeatureCollection"; features: LineFeature[] };
}

export interface Geometry {
  kind: "geometry";
  layers: GeometryLayer[];
  extent: Extent;
}

export interface Paper {
  widthMm: number;
  heightMm: number;
}

export interface PlotLayer {
  id: string;
  name: string;
  pen: Pen;
  /** Ordered strokes in mm on the paper, top-left origin, y down. */
  paths: Position[][];
  drawLengthMm: number;
  travelLengthMm: number;
  timeEstimateS: number;
}

/** Geometry placed on paper in mm, ordered, with pen-up travel and a time estimate. */
export interface Plot {
  kind: "plot";
  paper: Paper;
  layers: PlotLayer[];
  /** Plot-wide totals, including pen changes between layers. */
  timeEstimateS: number;
  machine: string;
}

export type StageData = Image | Layers | Geometry | Plot;
export type StageKind = StageData["kind"];

export type StageDataOf<K extends StageKind> = Extract<StageData, { kind: K }>;
