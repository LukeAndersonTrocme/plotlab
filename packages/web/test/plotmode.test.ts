import { describe, expect, it } from "vitest";
import type { Ink, Plot, Position } from "@plotlab/engine";
import { estimatePlot, getMachine, timeBreakdown } from "@plotlab/machines";
import { advance, fitSolo, framePlot, frameLabel, movePass, outputFormats, passBoxes, penLifts, PLAY_MS, sendState, soloPlot, startPlay, timeRows } from "../src/plotmode.ts";

const ink = (id: string, color: string): Ink => ({ id, name: id, color, mix: "multiply", widthMm: 0.5 });
const yellow = ink("Yellow", "#f2d500");
const black = ink("Black", "#1a1a1a");
/** Two passes: light (two 10 mm strokes) then dark (one 20 mm stroke and a dot). */
const plot: Plot = {
  kind: "plot",
  paper: { widthMm: 100, heightMm: 100 },
  ordered: true,
  layers: [
    { id: "light", name: "Light", ink: yellow, paths: [[[0, 0], [10, 0]], [[0, 10], [10, 10]]] },
    { id: "dark", name: "Dark", ink: black, paths: [[[0, 20], [20, 20]], [[50, 50]]] },
  ],
};
const machine = getMachine("generic");
const est = estimatePlot(plot, machine);

describe("Plot mode: time breakdown", () => {
  it("has one row per part of estimatePlot's time, adding up to its total", () => {
    const rows = timeRows(plot, est);
    const parts = timeBreakdown(est);
    expect(rows.map((r) => r.key)).toEqual(["draw", "travel", "pen", "penChanges"]);
    for (const r of rows) expect(r.seconds).toBe(parts[r.key]);
    expect(rows.reduce((t, r) => t + r.seconds, 0)).toBeCloseTo(est.totalS, 9);
  });

  it("says each part in plain words: lengths drawn and travelled, how many pen lifts and pen changes", () => {
    const rows = Object.fromEntries(timeRows(plot, est).map((r) => [r.key, r]));
    expect(rows.draw!.label).toBe("Drawing");
    expect(rows.draw!.detail).toBe("0.04 m");
    expect(rows.travel!.label).toBe("Travel");
    expect(rows.pen!.label).toBe("Pen lifts");
    expect(rows.pen!.detail).toBe("4");
    expect(rows.penChanges!.label).toBe("Pen changes");
    expect(rows.penChanges!.detail).toBe("1");
  });

  it("counts a pen lift per stroke the estimate lifts for (empty strokes don't count)", () => {
    const withEmpty: Plot = { ...plot, layers: [{ ...plot.layers[0]!, paths: [...plot.layers[0]!.paths, []] }] };
    expect(penLifts(plot)).toBe(4);
    expect(penLifts(withEmpty)).toBe(2);
    // The estimate's pen time is exactly one up + down per lift.
    expect(timeBreakdown(est).pen).toBeCloseTo(penLifts(plot) * (machine.pen.upS + machine.pen.downS), 9);
  });
});

describe("Plot mode: pass order", () => {
  it("moving a pass earlier or later gives the new order as passOrder (layer ids)", () => {
    expect(movePass(plot, 1, -1)).toEqual(["dark", "light"]);
    expect(movePass(plot, 0, 1)).toEqual(["dark", "light"]);
  });

  it("can't move the first pass earlier or the last one later", () => {
    expect(movePass(plot, 0, -1)).toBeNull();
    expect(movePass(plot, 1, 1)).toBeNull();
  });

  it("one box per pass, in pass order, with its ink, line count and time", () => {
    const boxes = passBoxes(plot, est);
    expect(boxes.map((b) => b.id)).toEqual(["light", "dark"]);
    expect(boxes[0]).toMatchObject({ name: "Light", color: "#f2d500", lines: 2, timeS: est.passes[0]!.timeS });
    expect(boxes[1]).toMatchObject({ name: "Dark", lines: 2, timeS: est.passes[1]!.timeS });
    expect(passBoxes(plot, null)[0]!.timeS).toBeNull();
  });
});

describe("Plot mode: one pen", () => {
  it("solo shows only that pen's lines; no solo shows them all", () => {
    expect(soloPlot(plot, "dark").layers.map((l) => l.id)).toEqual(["dark"]);
    expect(soloPlot(plot, null)).toBe(plot);
  });

  it("a soloed pen that's no longer in the plot goes back to all pens", () => {
    expect(fitSolo("dark", plot)).toBe("dark");
    expect(fitSolo("gone", plot)).toBeNull();
    expect(fitSolo("dark", null)).toBeNull();
    expect(soloPlot(plot, "gone")).toBe(plot);
  });
});

describe("Plot mode: plot-order animation", () => {
  const lines = (p: Plot) => p.layers.map((l) => l.paths);

  it("at the end it is the whole plot, with no pen marker", () => {
    const f = framePlot(plot, 1);
    expect(f.plot).toBe(plot);
    expect(f.head).toBeNull();
  });

  it("at the start nothing is drawn yet", () => {
    const f = framePlot(plot, 0);
    expect(lines(f.plot)).toEqual([[], []]);
  });

  it("draws in pass order, then stroke order, cutting the current stroke where the pen is", () => {
    // Weights: 10.5, 10.5 (light), 20.5, 0.5 (dark): total 42. Half way = 21: the light pass done.
    const half = framePlot(plot, 0.5);
    expect(lines(half.plot)[0]).toEqual(plot.layers[0]!.paths);
    expect(lines(half.plot)[1]).toEqual([]);
    // A quarter of the way through the dark stroke (31.5 - 21 = 10.5 → 10 mm in).
    const f = framePlot(plot, 31.5 / 42);
    const cut = lines(f.plot)[1]![0]! as Position[];
    expect(cut[0]).toEqual([0, 20]);
    expect(cut[1]![0]).toBeCloseTo(10, 9);
    expect(f.head).toEqual({ layerId: "dark", at: cut[1] });
  });

  it("strokes it has finished are the plot's own (so the canvas can reuse their drawing)", () => {
    const f = framePlot(plot, 0.9);
    expect(f.plot.layers[0]!.paths[0]).toBe(plot.layers[0]!.paths[0]);
  });

  it("works on a solo view too: only that pen animates", () => {
    const f = framePlot(soloPlot(plot, "dark"), 0.5);
    expect(f.plot.layers.map((l) => l.id)).toEqual(["dark"]);
    expect(f.head?.layerId).toBe("dark");
  });

  it("says where it is: which pass, and how far", () => {
    expect(frameLabel(plot, 1)).toBe("The whole plot");
    expect(frameLabel(plot, 0.75)).toBe("Pass 2 of 2: Dark · 75%");
    expect(frameLabel(plot, 0)).toBe("Pass 1 of 2: Light · 0%");
  });

  it("plays at a steady pace and stops at the end", () => {
    expect(advance(0, PLAY_MS / 4)).toBeCloseTo(0.25, 9);
    expect(advance(0.9, PLAY_MS)).toBe(1);
    // Negative or missing frame gaps (a tab in the background) don't go backwards.
    expect(advance(0.5, -10)).toBe(0.5);
  });

  it("Play at the end starts again from the beginning; anywhere else carries on", () => {
    expect(startPlay(1)).toBe(0);
    expect(startPlay(0.4)).toBe(0.4);
  });

  it("an empty plot is simply complete", () => {
    const empty: Plot = { ...plot, layers: [] };
    expect(framePlot(empty, 0.5).head).toBeNull();
    expect(frameLabel(empty, 0.5)).toBe("The whole plot");
  });
});

describe("Plot mode: output", () => {
  it("SVG and PNG always, after the target's own files", () => {
    expect(outputFormats({ kind: "plotter" })).toEqual(["svg", "png"]);
    expect(outputFormats({ kind: "vector" })).toEqual(["svg", "pdf", "png"]);
    expect(outputFormats({ kind: "raster", dpi: 300 })).toEqual(["png", "tiff", "svg"]);
  });

  it("Send works for a plotter with lines to plot", () => {
    expect(sendState({ kind: "plotter" }, true)).toEqual({ ok: true });
    const none = sendState({ kind: "plotter" }, false);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toMatch(/no lines/);
  });

  it("Send is off for digital targets, and says why in plain words", () => {
    for (const t of [{ kind: "raster", dpi: 300 }, { kind: "vector" }] as const) {
      const s = sendState(t, true);
      expect(s.ok).toBe(false);
      expect(!s.ok && s.reason).toMatch(/digital/i);
      expect(!s.ok && s.reason).toMatch(/Page/);
    }
    const p = sendState({ kind: "print", mode: "threshold" } as never, true);
    expect(p.ok).toBe(false);
  });
});
