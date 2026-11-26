import type { Paper, Recipe, TargetKind } from "@plotlab/engine";
import { builtinMachines } from "@plotlab/machines";
import { PAPERS } from "./defaults.ts";

export const TARGETS: Array<{ kind: TargetKind; label: string; hint: string }> = [
  { kind: "plotter", label: "Plotter", hint: "Pens on paper. Shows plot time and pen changes." },
  { kind: "raster", label: "Digital image", hint: "A PNG or TIFF at the resolution below; inks mix like ink on paper." },
  { kind: "vector", label: "Digital vector", hint: "An SVG or PDF with strokes at their ink width; layers that aren't lines are embedded as images." },
  { kind: "print", label: "Print prep", hint: "One 1-bit or gray TIFF per ink (riso, screen print, relief, film), plus a proof." },
];

export const targetLabel = (kind: TargetKind) => TARGETS.find((t) => t.kind === kind)?.label ?? kind;

/** The named paper size these dimensions are (either orientation), or null for custom. */
export function paperName(p: Paper): string | null {
  const [a, b] = [Math.min(p.widthMm, p.heightMm), Math.max(p.widthMm, p.heightMm)];
  return Object.entries(PAPERS).find(([, q]) => Math.min(q.widthMm, q.heightMm) === a && Math.max(q.widthMm, q.heightMm) === b)?.[0] ?? null;
}

export const fmtTime = (s: number) => {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export interface SetupSummary {
  /** "A4", or the size in mm for custom paper. */
  paper: string;
  /** For named paper; custom paper's mm size already says it. */
  orientation: "portrait" | "landscape" | null;
  /** "2 pens" for a plotter, "2 inks" otherwise. */
  pens: string;
  colors: string[];
  /** The machine profile's name for a plotter, else the output target. */
  machine: string;
  /** Null until there is a plot time estimate (plotters only). */
  time: string | null;
}

/** What the setup chip says: paper · pens · machine · time estimate. */
export function setupSummary(r: Recipe, estimate: { totalS: number } | null): SetupSummary {
  const name = paperName(r.paper);
  const plotter = r.target.kind === "plotter";
  const n = r.inks.length;
  return {
    paper: name ?? `${r.paper.widthMm} × ${r.paper.heightMm} mm`,
    orientation: name ? (r.paper.widthMm > r.paper.heightMm ? "landscape" : "portrait") : null,
    pens: `${n} ${plotter ? "pen" : "ink"}${n === 1 ? "" : "s"}`,
    colors: r.inks.map((i) => i.color),
    machine: plotter ? (builtinMachines[r.machine]?.name ?? r.machine) : targetLabel(r.target.kind),
    time: plotter && estimate ? `~${fmtTime(estimate.totalS)}` : null,
  };
}
