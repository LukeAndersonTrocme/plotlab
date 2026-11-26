import type { InspectTarget } from "./protocol.ts";

/**
 * Compare stages (#75): the canvas split into strips, one per chosen step (or the source),
 * side by side or top to bottom, with draggable dividers. Pure and immutable like `view.ts`;
 * the comparison is part of the view (never a recipe edit) and is saved in the view block.
 * Strips name steps by stable id, so they follow their step when the chain is reordered.
 * The lens and boxes layouts come later (#76): their fields are here, with defaults, so the
 * saved shape doesn't change when they arrive.
 */

/** A strip shows a step (by `RecipeStep.id`) or the source. */
export type Band = string;
export type Layout = "cols" | "rows" | "lens" | "boxes";

export type Compare = {
  layout: Layout;
  /** cols/rows: one per strip, left to right or top to bottom. lens/boxes: [under, inLens?]. */
  bands: Band[];
  /** Divider positions as fractions of the paper, ascending; one fewer than the strips. */
  splits: number[];
  lens: { x: number; y: number; r: number };
  boxes: Array<{ x: number; y: number; w: number; h: number; step: Band }>;
};

/** The comparison only needs the step ids of the chain (and which steps are on, for “Every step”). */
export type Chain = { steps: ReadonlyArray<{ id: string; enabled?: boolean }> };

export const MAX_STRIPS = 6;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Narrowest a strip can be dragged, as a fraction of the paper: dividers can't cross. */
export const MIN_GAP = 0.04;
const DEFAULT_LENS = { x: 0.5, y: 0.42, r: 0.18 };
const LAYOUTS: readonly Layout[] = ["cols", "rows", "lens", "boxes"];

export const evenSplits = (n: number): number[] => Array.from({ length: Math.max(0, n - 1) }, (_, k) => (k + 1) / n);

export function makeCompare(bands: Band[], layout: Layout = "cols"): Compare {
  return { layout, bands: [...bands], splits: evenSplits(bands.length), lens: { ...DEFAULT_LENS }, boxes: [] };
}

/**
 * “This step vs the one before”: the step before `at` (the source for the first step), then
 * the step at `at`. With no step selected (`at` < 0): the source against the last step.
 */
export function thisVsBefore(chain: Chain, at: number, layout?: Layout): Compare {
  const ids = chain.steps.map((s) => s.id);
  if (at < 0 || at >= ids.length) return makeCompare(ids.length ? ["source", ids.at(-1)!] : ["source"], layout);
  return makeCompare([at > 0 ? ids[at - 1]! : "source", ids[at]!], layout);
}

/** “Every step”: the source, then each step that's on; at most six strips (the last steps). */
export function everyStep(chain: Chain, layout?: Layout): Compare {
  const on = chain.steps.filter((s) => s.enabled !== false).map((s) => s.id);
  return makeCompare(["source", ...on.slice(-(MAX_STRIPS - 1))], layout);
}

/** Another strip at the end, the strips spaced evenly again. At six strips, nothing changes. */
export function addBand(c: Compare, band: Band): Compare {
  if (c.bands.length >= MAX_STRIPS) return c;
  const bands = [...c.bands, band];
  return { ...c, bands, splits: evenSplits(bands.length) };
}

/** What “+ Strip” shows: the step after the last strip's step (the first step after the source). */
export function nextBand(c: Compare, chain: Chain): Band {
  const ids = chain.steps.map((s) => s.id);
  if (!ids.length) return "source";
  const last = ids.indexOf(c.bands.at(-1) ?? "source");
  return ids[Math.min(ids.length - 1, last + 1)]!;
}

/**
 * Remove strip `k`: its room goes to the strip before it (the first strip's to the one after),
 * and the other dividers stay where they were. The last strip stays.
 */
export function removeBand(c: Compare, k: number): Compare {
  if (c.bands.length <= 1 || k < 0 || k >= c.bands.length) return c;
  const gone = k > 0 ? k - 1 : 0;
  return { ...c, bands: c.bands.filter((_, i) => i !== k), splits: c.splits.filter((_, i) => i !== gone) };
}

/** Whether a strip other than `k` already shows `band` (one strip per step, as with shift-click). */
export const bandInUse = (c: Compare, k: number, band: Band) => c.bands.some((b, i) => i !== k && b === band);

/** A strip's chip: show another step (or the source) in strip `k`; not one another strip already shows. */
export function setBand(c: Compare, k: number, band: Band): Compare {
  if (k < 0 || k >= c.bands.length || c.bands[k] === band || bandInUse(c, k, band)) return c;
  return { ...c, bands: c.bands.map((b, i) => (i === k ? band : b)) };
}

export function setLayout(c: Compare, layout: Layout): Compare {
  return c.layout === layout ? c : { ...c, layout };
}

/** Drag divider `k` to `f` (a fraction of the paper); it stops a minimum gap short of its neighbours and the paper's edges. */
export function dragSplit(c: Compare, k: number, f: number): Compare {
  if (k < 0 || k >= c.splits.length) return c;
  const lo = (k > 0 ? c.splits[k - 1]! : 0) + MIN_GAP;
  const hi = (k < c.splits.length - 1 ? c.splits[k + 1]! : 1) - MIN_GAP;
  const at = Math.min(hi, Math.max(lo, f));
  return at === c.splits[k] ? c : { ...c, splits: c.splits.map((s, i) => (i === k ? at : s)) };
}

/** Dividers that fit `n` strips: ascending, a minimum gap apart and from the edges. */
function splitsFit(s: readonly unknown[], n: number): s is number[] {
  const eps = 1e-9;
  return s.length === n - 1 && s.every((x, i) => num(x) && x >= MIN_GAP - eps && x <= 1 - MIN_GAP + eps && (i === 0 || x - (s[i - 1] as number) >= MIN_GAP - eps));
}

/**
 * The end of a divider drag: the dragged dividers put on the comparison as it is now (a strip
 * may have changed, or gone, meanwhile). If they no longer fit, the comparison stays as it is.
 */
export function applySplits(c: Compare, splits: readonly number[]): Compare {
  if (!splitsFit(splits, c.bands.length) || splits.every((x, i) => x === c.splits[i])) return c;
  return { ...c, splits: [...splits] };
}

/**
 * The worker's reply strip `k` may draw: one for the strip's own step (by id) at its current
 * place in the chain. A reply from an older run can carry an index that now belongs to another
 * step (an earlier step removed, a chip changed); that one waits for the newer run.
 */
export function stripView<V extends { step?: string; index: number }>(views: ReadonlyArray<V | null> | null, bands: readonly Band[], targets: readonly InspectTarget[], k: number): V | null {
  const v = views?.[k];
  const t = targets[k];
  if (!v || t === undefined || t === null) return null;
  return v.step === bands[k] && v.index === (t === "source" ? -1 : t) ? v : null;
}

const known = (chain: Chain) => {
  const ids = new Set(chain.steps.map((s) => s.id));
  return (b: Band) => b === "source" || ids.has(b);
};

/**
 * After a chain edit: drop the strips (and boxes) of steps that are gone, each giving its room
 * to its neighbour. Null when no strip is left. Dropping them matters: the engine gives a new
 * step the lowest free id, so a Fill added after removing Fill is "fill" again and mustn't
 * come back as a strip.
 */
export function pruneCompare(c: Compare, chain: Chain): Compare | null {
  const ok = known(chain);
  let next = c;
  for (let k = c.bands.length - 1; k >= 0; k--) if (!ok(c.bands[k]!)) next = next.bands.length > 1 ? removeBand(next, k) : { ...next, bands: [] };
  if (!next.bands.length) return null;
  const boxes = next.boxes.filter((b) => ok(b.step));
  return boxes.length === next.boxes.length ? next : { ...next, boxes };
}

/** What the worker draws for each strip: "source", or the step's place in the chain (-1: not there). */
export function compareTargets(c: Compare, chain: Chain): InspectTarget[] {
  return c.bands.map((b) => (b === "source" ? "source" : chain.steps.findIndex((s) => s.id === b)));
}

const rec = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/**
 * A saved comparison, for this recipe: strips of steps that aren't in it are dropped, at most
 * six are kept, and damaged parts get their defaults. Null when nothing usable is left.
 */
export function readCompare(raw: unknown, chain: Chain): Compare | null {
  const o = rec(raw);
  if (!o || !Array.isArray(o.bands)) return null;
  const ok = known(chain);
  const strings = o.bands.filter((b): b is string => typeof b === "string").slice(0, MAX_STRIPS);
  const layout = LAYOUTS.includes(o.layout as Layout) ? (o.layout as Layout) : "cols";
  const s = Array.isArray(o.splits) ? o.splits : [];
  const l = rec(o.lens);
  const lens = l && num(l.x) && num(l.y) && num(l.r) ? { x: l.x, y: l.y, r: l.r } : { ...DEFAULT_LENS };
  const boxes = (Array.isArray(o.boxes) ? o.boxes : [])
    .map(rec)
    .filter((b): b is Record<string, unknown> => !!b && num(b.x) && num(b.y) && num(b.w) && num(b.h) && typeof b.step === "string")
    .map((b) => ({ x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number, step: b.step as string }));
  const read: Compare = { layout, bands: strings, splits: splitsFit(s, strings.length) ? [...s] : evenSplits(strings.length), lens, boxes };
  return read.bands.length ? pruneCompare(read, chain) : null;
}
