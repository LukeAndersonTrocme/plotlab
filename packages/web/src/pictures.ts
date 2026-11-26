import type { Pipeline, Recipe, Source } from "@plotlab/engine";
import type { ToWorker } from "./protocol.ts";

/**
 * Pictures that aren't the canvas: a checkpoint's picture and the preset gallery. They never
 * get in the way of the canvas. They run on their own pipeline (the canvas cache stays as it
 * is), at about the picture's size, without running on-demand steps (one that hasn't been run
 * stays stale and is drawn in traced order), and in the background behind any run.
 */
export function drawResult(pipe: Pipeline, src: { source: Source; key: string }, recipe: Recipe, side: number) {
  return pipe.run(src.source, recipe, { sourceKey: src.key, maxSidePx: Math.max(side, 160), runOnDemand: false });
}

/**
 * Foreground messages are the ones the screen waits on: they go first, and while one waits
 * the strip's thumbnails are cut short. Pictures wait in the background. Each checkpoint
 * picture has its own group, so none is dropped; the gallery has one group, so a newer
 * request replaces what's left of the old one. Plot mode's pass pictures are queued by the
 * worker itself after a run (group "passes", drawn from that run's plot), the same way.
 */
export function laneOf(msg: ToWorker): { lane: "foreground" } | { lane: "background"; group: string } {
  switch (msg.type) {
    case "thumbnail":
      return { lane: "background", group: `picture:${msg.id}` };
    case "gallery":
      return { lane: "background", group: "gallery" };
    default:
      return { lane: "foreground" };
  }
}
