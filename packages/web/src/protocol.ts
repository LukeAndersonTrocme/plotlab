import type { Plot, RawImage, Recipe } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";

export type ToWorker =
  | { type: "source"; image: RawImage; key: string }
  | { type: "run"; id: number; recipe: Recipe; proxy: boolean };

export type FromWorker =
  | {
      type: "result";
      id: number;
      proxy: boolean;
      plot: Plot | null;
      estimate: PlotEstimate | null;
      warnings: string[];
      timings: Array<{ step: string; ms: number; cached: boolean }>;
    }
  | { type: "error"; id: number; index?: number; message: string };
