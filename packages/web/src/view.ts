import type { InspectTarget } from "./protocol.ts";

/**
 * The web UI's view state: what the screen shows, as opposed to the recipe (what gets made).
 * Pure and immutable, like `history.ts`: React holds one ViewState and renders from it.
 * Changing the view is never a recipe edit (no Back step). Later slices add pins, the
 * comparison and lanes here.
 */

/** Design: the steps. Page: paper, inks and machine. Plot: the output. */
export type Mode = "design" | "page" | "plot";

export const MODES: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "design", label: "Design", hint: "The steps that turn the image into lines" },
  { mode: "page", label: "Page", hint: "Paper, inks and machine" },
  { mode: "plot", label: "Plot", hint: "Time estimate and the files to download" },
];

/** What the canvas shows in Design mode, and whose settings the sidebar puts first. */
export type Selection = { kind: "result" } | { kind: "source" } | { kind: "step"; index: number };

export const RESULT: Selection = { kind: "result" };
export const SOURCE: Selection = { kind: "source" };
export const stepSelection = (index: number): Selection => ({ kind: "step", index });

export interface ViewState {
  mode: Mode;
  selection: Selection;
}

export const initialView: ViewState = { mode: "design", selection: RESULT };

export const sameSelection = (a: Selection, b: Selection) =>
  a.kind === b.kind && (a.kind !== "step" || a.index === (b as { index: number }).index);

/** Each transition returns the same object when nothing changes, so React can skip a render. */
export function setMode(v: ViewState, mode: Mode): ViewState {
  return v.mode === mode ? v : { ...v, mode };
}

/** The setup chip in the top bar opens Page mode. */
export const openSetup = (v: ViewState) => setMode(v, "page");

/** Look at a step (or the source, or the result). Step settings live in Design, so go there. */
export function select(v: ViewState, selection: Selection): ViewState {
  if (v.mode === "design" && sameSelection(v.selection, selection)) return v;
  return { ...v, mode: "design", selection };
}

/** Clicking what's already selected (in Design) goes back to the result. */
export function toggleSelect(v: ViewState, selection: Selection): ViewState {
  if (v.mode === "design" && sameSelection(v.selection, selection)) return select(v, RESULT);
  return select(v, selection);
}

/** After a chain edit: a selected step past the end of the chain falls back to the result. */
export function fitSelection(v: ViewState, stepCount: number): ViewState {
  return v.selection.kind === "step" && v.selection.index >= stepCount ? { ...v, selection: RESULT } : v;
}

/** What the worker should render: the selection in Design; the result in Page and Plot. */
export function canvasTarget(v: ViewState): InspectTarget {
  if (v.mode !== "design") return null;
  const s = v.selection;
  return s.kind === "step" ? s.index : s.kind === "source" ? "source" : null;
}
