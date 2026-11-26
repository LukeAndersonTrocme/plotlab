import { describe, expect, it } from "vitest";
import { Pipeline, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe } from "../src/defaults.ts";
import { drawResult, laneOf } from "../src/pictures.ts";
import type { ToWorker } from "../src/protocol.ts";

const registry = createRegistry();
/** A 300×200 left-to-right gradient. */
function gradient(): { source: { width: number; height: number; channels: 1; data: Float32Array }; key: string } {
  const width = 300, height = 200;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = x / width;
  return { source: { width, height, channels: 1, data }, key: "gradient" };
}
const recipe = defaultRecipe(); // Threshold → Centerline → Stroke order (on-demand)
const orderAt = recipe.steps.findIndex((s) => s.step === "order");

describe("pictures (checkpoint and gallery)", () => {
  it("never runs an on-demand step that hasn't been run: it stays stale, the picture shows traced order", async () => {
    const r = await drawResult(new Pipeline(registry), gradient(), recipe, 240);
    expect(orderAt).toBeGreaterThan(0);
    expect(r.stale).toEqual([orderAt]);
    expect(r.results.map((x) => x.step)).not.toContain("order");
    expect(r.output.kind).toBe("geometry");
  });

  it("works at about the picture's size, not full resolution", async () => {
    const r = await drawResult(new Pipeline(registry), gradient(), { ...recipe, workingMmPerPx: 0.1 } as Recipe, 240);
    expect(r.placed.kind === "image" && Math.max(r.placed.width, r.placed.height)).toBeLessThanOrEqual(240);
  });
});

describe("which worker messages the screen waits on", () => {
  const r = defaultRecipe();
  it("runs, exports and a new source are foreground: they go first and cut strip pictures short", () => {
    const run: ToWorker = { type: "run", id: 1, recipe: r, proxy: false, inspect: null, runOnDemand: false, proof: false, thumbs: null, passes: 96 };
    expect(laneOf(run)).toEqual({ lane: "foreground" });
    expect(laneOf({ type: "export", id: 2, recipe: r, format: "svg", stem: "x" })).toEqual({ lane: "foreground" });
    expect(laneOf({ type: "source", source: gradient().source, key: "k" })).toEqual({ lane: "foreground" });
  });

  it("a checkpoint's picture waits in the background and is never dropped by another one", () => {
    const a = laneOf({ type: "thumbnail", id: 3, recipe: r, side: 240 });
    const b = laneOf({ type: "thumbnail", id: 4, recipe: r, side: 240 });
    expect(a.lane).toBe("background");
    expect(b.lane).toBe("background");
    expect(a).not.toEqual(b);
  });

  it("gallery pictures share one background group, so a newer gallery replaces the old one", () => {
    expect(laneOf({ type: "gallery", id: 5, side: 200, items: [] })).toEqual({ lane: "background", group: "gallery" });
    expect(laneOf({ type: "gallery", id: 6, side: 200, items: [] })).toEqual({ lane: "background", group: "gallery" });
  });
});
