import type { Plot, Position } from "@plotlab/engine";
import type { MachineProfile } from "./profile.ts";

/**
 * Time for a straight move of `d` mm with trapezoidal (or triangular) velocity,
 * entering and leaving at `vEdge`, cruising at most at `vMax`.
 */
export function moveTime(d: number, vMax: number, accel: number, vEdge = 0): number {
  if (d <= 0) return 0;
  const v0 = Math.min(vEdge, vMax);
  const dAccel = (vMax * vMax - v0 * v0) / (2 * accel);
  if (2 * dAccel <= d) {
    return (2 * (vMax - v0)) / accel + (d - 2 * dAccel) / vMax;
  }
  // Triangular: peak speed reached mid-move.
  const vPeak = Math.sqrt(v0 * v0 + accel * d);
  return (2 * (vPeak - v0)) / accel;
}

const dist = (a: Position, b: Position) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function pathLength(path: Position[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(path[i - 1]!, path[i]!);
  return s;
}

export interface LayerEstimate {
  drawLengthMm: number;
  travelLengthMm: number;
  timeS: number;
}

/** Estimate one layer: pen-down strokes plus pen-up travel, starting and ending at the origin. */
export function estimateLayer(paths: Position[][], m: MachineProfile): LayerEstimate {
  const { drawMmS, travelMmS, accelMmS2, cornerSpeedFactor } = m.motion;
  const vCorner = drawMmS * cornerSpeedFactor;
  let draw = 0;
  let travel = 0;
  let t = 0;
  let at: Position = [0, 0];
  for (const p of paths) {
    if (p.length === 0) continue;
    const dt = dist(at, p[0]!);
    travel += dt;
    t += moveTime(dt, travelMmS, accelMmS2) + m.pen.downS;
    for (let i = 1; i < p.length; i++) {
      const d = dist(p[i - 1]!, p[i]!);
      draw += d;
      t += moveTime(d, drawMmS, accelMmS2, vCorner);
    }
    t += m.pen.upS;
    at = p[p.length - 1]!;
  }
  const home = dist(at, [0, 0]);
  travel += home;
  t += moveTime(home, travelMmS, accelMmS2);
  return { drawLengthMm: draw, travelLengthMm: travel, timeS: t };
}

export interface PassEstimate extends LayerEstimate {
  layerId: string;
}

export interface PlotEstimate {
  passes: PassEstimate[];
  /** Pen changes between passes that draw something. */
  penChanges: number;
  totalS: number;
}

/** Time readout for a plot on a machine: each pass, plus a pause per pen change (ADR 0011). */
export function estimatePlot(plot: Plot, m: MachineProfile): PlotEstimate {
  const passes = plot.layers.map((l) => ({ layerId: l.id, ...estimateLayer(l.paths, m) }));
  const drawing = plot.layers.filter((l) => l.paths.some((p) => p.length > 0)).length;
  const penChanges = Math.max(0, drawing - 1);
  const totalS = passes.reduce((t, p) => t + p.timeS, 0) + penChanges * m.pen.changeS;
  return { passes, penChanges, totalS };
}
