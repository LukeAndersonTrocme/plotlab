import type { Image, Plot, Recipe } from "@plotlab/engine";

export type ToWorker =
  | { type: "source"; image: Image; key: string }
  | { type: "run"; id: number; recipe: Recipe; proxy: boolean };

export type FromWorker =
  | { type: "result"; id: number; proxy: boolean; plot: Plot; timings: Array<{ step: string; ms: number; cached: boolean }> }
  | { type: "error"; id: number; message: string };
