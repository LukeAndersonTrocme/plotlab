import type { Frame, LayerInfo, Plot, RawImage, Recipe, StageKind } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";

/** What to show in the view: a step's output (by index), the placed source, or the end result. */
export type InspectTarget = number | "source" | null;

/** A raster encoded as PNG, laid over `frame` on the paper. `color` is null for images. */
export interface RasterView {
  id: string;
  name: string;
  color: string | null;
  mix: "multiply" | "normal";
  frame: Frame;
  png: Blob;
}

/** A stage's data, ready to draw: rasters (image or layers) and/or lines. */
export interface InspectView {
  kind: StageKind | "source";
  /** Step index, or -1 for the source. */
  index: number;
  rasters: RasterView[];
  plot: Plot | null;
}

export interface StepInfo {
  index: number;
  step: string;
  ms: number;
  cached: boolean;
  layers: LayerInfo[];
}

export type ToWorker =
  | { type: "source"; image: RawImage; key: string }
  | { type: "run"; id: number; recipe: Recipe; proxy: boolean; inspect: InspectTarget };

export type FromWorker =
  | {
      type: "result";
      id: number;
      proxy: boolean;
      plot: Plot | null;
      estimate: PlotEstimate | null;
      warnings: string[];
      /** The working raster: what step 1 sees (full-resolution runs only). */
      working: { width: number; height: number; mmPerPx: number };
      steps: StepInfo[];
      /** Layers that never became lines, ready to composite under the plot. */
      rasterLayers: RasterView[];
      inspected: InspectView | null;
      underlay: RasterView | null;
    }
  | { type: "error"; id: number; index?: number; message: string };
