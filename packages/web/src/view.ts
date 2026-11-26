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

/**
 * What the canvas shows in Design mode, and whose settings the sidebar shows. A step is
 * named by its stable id (`RecipeStep.id`), so the selection follows it when the chain is
 * reordered; resolve it to a chain position with `canvasTarget` or `selectedIndex`.
 */
export type Selection = { kind: "result" } | { kind: "source" } | { kind: "step"; id: string };

export const RESULT: Selection = { kind: "result" };
export const SOURCE: Selection = { kind: "source" };
export const stepSelection = (id: string): Selection => ({ kind: "step", id });

/** The view only needs the step ids of the chain. */
export type Chain = { steps: ReadonlyArray<{ id: string }> };

export interface ViewState {
  mode: Mode;
  selection: Selection;
}

export const initialView: ViewState = { mode: "design", selection: RESULT };

export const sameSelection = (a: Selection, b: Selection) =>
  a.kind === b.kind && (a.kind !== "step" || a.id === (b as { id: string }).id);

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

/** Chain position of the selected step; -1 when no step (or a step that's gone) is selected. */
export function selectedIndex(v: ViewState, chain: Chain): number {
  const s = v.selection;
  return s.kind === "step" ? chain.steps.findIndex((x) => x.id === s.id) : -1;
}

/**
 * After a chain edit (or Back/Forward): a selected step that's gone falls back to the nearest
 * step before it that is still there (what now feeds the rest of the chain), else the result.
 */
export function fitSelection(v: ViewState, before: Chain, after: Chain): ViewState {
  const s = v.selection;
  if (s.kind !== "step") return v;
  const left = new Set(after.steps.map((x) => x.id));
  if (left.has(s.id)) return v;
  const at = before.steps.findIndex((x) => x.id === s.id);
  for (let i = at - 1; i >= 0; i--) {
    const id = before.steps[i]!.id;
    if (left.has(id)) return { ...v, selection: stepSelection(id) };
  }
  return { ...v, selection: RESULT };
}

/** What the worker should render: the selection in Design; the result in Page and Plot. */
export function canvasTarget(v: ViewState, chain: Chain): InspectTarget {
  if (v.mode !== "design") return null;
  const s = v.selection;
  if (s.kind === "source") return "source";
  const i = selectedIndex(v, chain);
  return i < 0 ? null : i;
}
