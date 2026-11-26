import type { ExportFormat, Frame, LayerInfo, Plot, Recipe, Source, StageKind } from "@plotlab/engine";
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
  /** The step's stable id (`RecipeStep.id`). */
  id: string;
  step: string;
  ms: number;
  cached: boolean;
  layers: LayerInfo[];
}

export type ToWorker =
  | { type: "source"; source: Source; key: string }
  | {
      type: "run";
      id: number;
      recipe: Recipe;
      proxy: boolean;
      inspect: InspectTarget;
      runOnDemand: boolean;
      proof: boolean;
      /** Also send strip thumbnails, this many pixels on the paper's long side; null = none. */
      thumbs: number | null;
    }
  /** Full-resolution run (on-demand steps included) → files for the target. */
  | { type: "export"; id: number; recipe: Recipe; format: ExportFormat; stem: string };

export type FromWorker =
  | {
      type: "result";
      id: number;
      proxy: boolean;
      plot: Plot | null;
      estimate: PlotEstimate | null;
      warnings: string[];
      /** The working raster: what step 1 sees (full-resolution runs only; null for SVG lines). */
      working: { width: number; height: number; mmPerPx: number } | null;
      steps: StepInfo[];
      /** On-demand steps that need a Run (their output would be stale). */
      stale: number[];
      /** The image or layers wherever the chain stopped short of lines, to composite under the plot. */
      rasterLayers: RasterView[];
      inspected: InspectView | null;
      underlay: RasterView | null;
      /** The page as it will export (when asked for). */
      proof: RasterView | null;
    }
  /**
   * Strip thumbnails after a run, by box key ("source" or step id). Sent after the result and
   * cut short when a newer request is waiting (the canvas comes first), so `items` may cover
   * only some of `keys`; keys not listed are no longer in the strip.
   */
  | { type: "thumbs"; id: number; side: number; keys: string[]; items: Array<{ key: string; png: Blob }> }
  | { type: "exported"; id: number; name: string; mime: string; data: Uint8Array | string; notes: string[] }
  | { type: "export-error"; id: number; message: string }
  | { type: "error"; id: number; index?: number; message: string };
