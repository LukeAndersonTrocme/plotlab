import type { InspectTarget } from "./protocol.ts";

/**
 * The web UI's view state: what the screen shows, as opposed to the recipe (what gets made).
 * Pure and immutable, like `history.ts`: React holds one ViewState and renders from it.
 * Changing the view is never a recipe edit (no Back step, no checkpoint). The part worth
 * keeping with the project (pins now, the comparison later) is saved as the project's view
 * block (`toViewBlock` / `fromViewBlock`); the rest lasts for the session, or (the thumbnail
 * size) is a per-device preference.
 */

/** Design: the steps. Page: paper, inks and machine. Plot: the output. */
export type Mode = "design" | "page" | "plot";

export const MODES: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "design", label: "Design", hint: "The steps that turn the image into lines" },
  { mode: "page", label: "Page", hint: "Paper, inks and machine" },
  { mode: "plot", label: "Plot", hint: "Time estimate, pass order, watch it plot, send and download" },
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

/** Thumbnail size in the step strip, in CSS px: a per-device preference, not part of the project. */
export const THUMB = { min: 56, max: 200, step: 24, default: 96 } as const;

export interface ViewState {
  mode: Mode;
  selection: Selection;
  /** Thumbnail size in the step strip (CSS px). */
  thumb: number;
  /** Pinned steps, by step id: their settings stay in the sidebar. Shown in recipe order. */
  pins: readonly string[];
  /** Plot mode: the one pen (pass, by layer id) shown on its own; null = every pen. Not saved. */
  solo: string | null;
}

export const initialView: ViewState = { mode: "design", selection: RESULT, thumb: THUMB.default, pins: [], solo: null };

const clampThumb = (px: number) => Math.round(Math.min(THUMB.max, Math.max(THUMB.min, px)));

/** Bigger or smaller thumbnails (the grip, or − / +). */
export function resizeThumbs(v: ViewState, px: number): ViewState {
  const thumb = clampThumb(px);
  return thumb === v.thumb ? v : { ...v, thumb };
}

/** Where this device remembers the thumbnail size. */
export const THUMB_KEY = "plotlab:thumb-size";
type KeyValue = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** The remembered thumbnail size; the default when there is none, it can't be read, or storage is off. */
export function readThumbSize(storage: KeyValue | null): number {
  try {
    const n = Number(storage?.getItem(THUMB_KEY) ?? NaN);
    return Number.isFinite(n) && n > 0 ? clampThumb(n) : THUMB.default;
  } catch {
    return THUMB.default;
  }
}

export function writeThumbSize(storage: KeyValue | null, px: number): void {
  try {
    storage?.setItem(THUMB_KEY, String(clampThumb(px)));
  } catch {
    // Private windows and blocked storage: the size just isn't remembered.
  }
}

export const sameSelection = (a: Selection, b: Selection) =>
  a.kind === b.kind && (a.kind !== "step" || a.id === (b as { id: string }).id);

/** Each transition returns the same object when nothing changes, so React can skip a render. */
export function setMode(v: ViewState, mode: Mode): ViewState {
  // Leaving Plot mode goes back to every pen.
  return v.mode === mode ? v : { ...v, mode, solo: null };
}

/** A pen box in Plot mode: show only that pen; the same pen again, or null (All), shows every pen. */
export function toggleSolo(v: ViewState, id: string | null): ViewState {
  const solo = id === null || v.solo === id ? null : id;
  return solo === v.solo ? v : { ...v, solo };
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

/**
 * After a chain edit (or Back/Forward): fit the selection (`fitSelection`) and drop the pins
 * of steps that are gone. Dropping them matters: the engine gives a new step the lowest free
 * id, so a Fill added after removing Fill is "fill" again and mustn't come back pinned.
 */
export function fitView(v: ViewState, before: Chain, after: Chain): ViewState {
  const w = fitSelection(v, before, after);
  const left = new Set(after.steps.map((x) => x.id));
  const pins = w.pins.filter((id) => left.has(id));
  return pins.length === w.pins.length ? w : { ...w, pins };
}

export const isPinned = (v: ViewState, id: string) => v.pins.includes(id);

/** Keep a step's settings in the sidebar while looking at other steps. */
export function pin(v: ViewState, id: string): ViewState {
  return isPinned(v, id) ? v : { ...v, pins: [...v.pins, id] };
}

export function unpin(v: ViewState, id: string): ViewState {
  return isPinned(v, id) ? { ...v, pins: v.pins.filter((p) => p !== id) } : v;
}

export const togglePin = (v: ViewState, id: string) => (isPinned(v, id) ? unpin(v, id) : pin(v, id));

/**
 * The step cards in the sidebar (Design): the step being looked at always on top, pinned or
 * not, then the other pinned steps in recipe order. `looking` is null for the source or the
 * result (which shows every step).
 */
export function sidebarSteps(v: ViewState, chain: Chain): { looking: string | null; pinned: string[]; lookingPinned: boolean } {
  const at = selectedIndex(v, chain);
  const looking = at < 0 ? null : chain.steps[at]!.id;
  const pinned = chain.steps.map((s) => s.id).filter((id) => id !== looking && isPinned(v, id));
  return { looking, pinned, lookingPinned: looking !== null && isPinned(v, looking) };
}

/**
 * The project's view block: `view.json` in the project folder (ADR 0014), beside recipe.json
 * and not part of it. Version 1 holds the pins; the comparison (#75) goes here next.
 */
export const VIEW_BLOCK_VERSION = 1;

export interface ViewBlock {
  version: number;
  pins: string[];
  /** Whatever a newer build saved that this one doesn't know: kept, not lost. */
  [more: string]: unknown;
}

const record = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** The view block to save. `kept`: the block as read, so fields from a newer build survive. */
export function toViewBlock(v: ViewState, kept?: unknown): ViewBlock {
  const old = record(kept) ?? {};
  const version = Math.max(VIEW_BLOCK_VERSION, typeof old.version === "number" ? old.version : 0);
  return { ...old, version, pins: [...v.pins] };
}

/**
 * The view with a project's saved view block applied: its pins, for steps that are in this
 * recipe. A missing or unreadable block (or part of one) is ignored: it's only the view.
 */
export function fromViewBlock(v: ViewState, block: unknown, chain: Chain): ViewState {
  const raw = record(block)?.pins;
  const ids = new Set(chain.steps.map((s) => s.id));
  const pins = Array.isArray(raw) ? [...new Set(raw.filter((p): p is string => typeof p === "string" && ids.has(p)))] : [];
  if (!Array.isArray(raw) && !v.pins.length) return v;
  return pins.join("\n") === v.pins.join("\n") ? v : { ...v, pins };
}

/** What the worker should render: the selection in Design; the result in Page and Plot. */
export function canvasTarget(v: ViewState, chain: Chain): InspectTarget {
  if (v.mode !== "design") return null;
  const s = v.selection;
  if (s.kind === "source") return "source";
  const i = selectedIndex(v, chain);
  return i < 0 ? null : i;
}
