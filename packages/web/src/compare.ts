import type { InspectTarget } from "./protocol.ts";

/**
 * Compare stages (#75): the canvas split into strips, one per chosen step (or the source),
 * side by side or top to bottom, with draggable dividers. Pure and immutable like `view.ts`;
 * the comparison is part of the view (never a recipe edit) and is saved in the view block.
 * Strips name steps by stable id, so they follow their step when the chain is reordered.
 *
 * Two more layouts (#76): the lens, a circle showing one step over another, and boxes,
 * rectangles drawn on the image that each show a step over the one underneath. Their places
 * are fractions of the image (x across, y down; the lens radius a fraction of the shorter
 * side), so they survive the canvas changing size. The lens and boxes keep the strips' list:
 * `bands[0]` is underneath, `bands[1]` in the lens, and any further strips wait, unseen, for
 * side by side to come back.
 */

/** A strip shows a step (by `RecipeStep.id`) or the source. */
export type Band = string;
export type Layout = "cols" | "rows" | "lens" | "boxes";

export type Lens = { x: number; y: number; r: number };
/** A box's place: top-left corner and size, fractions of the image. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Box = Rect & { step: Band };

export type Compare = {
  layout: Layout;
  /** cols/rows: one per strip, left to right or top to bottom. lens/boxes: [under, inLens?]. */
  bands: Band[];
  /** Divider positions as fractions of the paper, ascending; one fewer than the strips. */
  splits: number[];
  lens: Lens;
  boxes: Box[];
};

/** The comparison only needs the step ids of the chain (and which steps are on, for “Every step”). */
export type Chain = { steps: ReadonlyArray<{ id: string; enabled?: boolean }> };

export const MAX_STRIPS = 6;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Narrowest a strip can be dragged, as a fraction of the paper: dividers can't cross. */
export const MIN_GAP = 0.04;
const DEFAULT_LENS = { x: 0.5, y: 0.42, r: 0.18 };
/** Smallest and largest lens radius, as fractions of the image's shorter side. */
export const MIN_LENS = 0.05;
export const MAX_LENS = 0.5;
/** Smallest box side, and the side of a box made by a click, as fractions of the image. */
export const MIN_BOX = 0.05;
export const DEFAULT_BOX = 0.28;
export const MAX_BOXES = 6;
/** A drag shorter than this (both ways) is a click. */
const CLICK = 0.02;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** The box the boxes layout starts with. */
const FIRST_BOX: Rect = { x: 0.3, y: 0.3, w: 0.4, h: 0.3 };
const LAYOUTS: readonly Layout[] = ["cols", "rows", "lens", "boxes"];

export const evenSplits = (n: number): number[] => Array.from({ length: Math.max(0, n - 1) }, (_, k) => (k + 1) / n);

export function makeCompare(bands: Band[], layout: Layout = "cols"): Compare {
  return { layout, bands: [...bands], splits: evenSplits(bands.length), lens: { ...DEFAULT_LENS }, boxes: [] };
}

/**
 * “This step vs the one before”: the step before `at` (the source for the first step), then
 * the step at `at`. With no step selected (`at` < 0): the source against the last step.
 */
export function thisVsBefore(chain: Chain, at: number, layout?: Layout, from?: Compare): Compare {
  const ids = chain.steps.map((s) => s.id);
  const c = at < 0 || at >= ids.length ? makeCompare(ids.length ? ["source", ids.at(-1)!] : ["source"], layout) : makeCompare([at > 0 ? ids[at - 1]! : "source", ids[at]!], layout);
  // From the lens or boxes: the lens stays where it is, and the boxes show this step.
  if (!from) return c;
  const step = c.bands.at(-1)!;
  if (layout !== "boxes") return { ...c, lens: from.lens, boxes: from.boxes };
  // Boxes with none drawn yet get one, as when switching to boxes, so "this step" is on show.
  return { ...c, lens: from.lens, boxes: from.boxes.length ? from.boxes.map((b) => ({ ...b, step })) : [{ ...FIRST_BOX, step }] };
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

/**
 * Switch layout. The lens needs two steps: with one, `fill` goes in the lens. Boxes start
 * with one box (when none are drawn yet), showing the second step, or `fill`.
 */
export function setLayout(c: Compare, layout: Layout, fill?: Band): Compare {
  if (c.layout === layout) return c;
  let next: Compare = { ...c, layout };
  if (layout === "lens" && next.bands.length < 2 && fill !== undefined && fill !== next.bands[0]) next = addBand(next, fill);
  const step = c.bands[1] ?? fill;
  if (layout === "boxes" && !next.boxes.length && step !== undefined) next = { ...next, boxes: [{ ...FIRST_BOX, step }] };
  return next;
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
 * to its neighbour. Null when no strip is left (with boxes still drawn, the source goes under them instead). Dropping them matters: the engine gives a new
 * step the lowest free id, so a Fill added after removing Fill is "fill" again and mustn't
 * come back as a strip.
 */
export function pruneCompare(c: Compare, chain: Chain): Compare | null {
  const ok = known(chain);
  let next = c;
  for (let k = c.bands.length - 1; k >= 0; k--) if (!ok(c.bands[k]!)) next = next.bands.length > 1 ? removeBand(next, k) : { ...next, bands: [] };
  const boxes = next.boxes.filter((b) => ok(b.step));
  // Boxes still drawn keep the comparison: the source goes underneath.
  if (!next.bands.length) {
    if (next.layout !== "boxes" || !boxes.length) return null;
    next = { ...next, bands: ["source"], splits: [] };
  }
  return boxes.length === next.boxes.length ? next : { ...next, boxes };
}

/**
 * The steps the canvas shows, each once: the strips (side by side, top to bottom); the step
 * under the lens and the one in it; the step under the boxes and each box's step.
 */
export function shownBands(c: Compare): Band[] {
  if (c.layout === "cols" || c.layout === "rows") return c.bands;
  const shown = c.layout === "lens" ? c.bands.slice(0, 2) : [c.bands[0]!, ...c.boxes.map((b) => b.step)];
  return [...new Set(shown)];
}

/** What the worker draws for each shown step (`shownBands`): "source", or the step's place in the chain (-1: not there). */
export function compareTargets(c: Compare, chain: Chain): InspectTarget[] {
  return shownBands(c).map((b) => (b === "source" ? "source" : chain.steps.findIndex((s) => s.id === b)));
}

/** The worker's reply the lens, the layer underneath or a box may draw for `band`: matched by step id and place, as `stripView`. */
export function bandView<V extends { step?: string; index: number }>(views: ReadonlyArray<V | null> | null, c: Compare, targets: readonly InspectTarget[], band: Band): V | null {
  const bands = shownBands(c);
  const k = bands.indexOf(band);
  return k < 0 ? null : stripView(views, bands, targets, k);
}

/* ---------- The lens ---------- */

/**
 * The lens brought inside an image `aspect` (width / height) times as wide as it is tall:
 * the radius between its limits, the centre far enough from the edges for the whole circle.
 */
export function fitLens(l: Lens, aspect = 1): Lens {
  const r = clamp(l.r, MIN_LENS, MAX_LENS);
  const rx = r * Math.min(1, 1 / aspect);
  const ry = r * Math.min(1, aspect);
  return { x: clamp(l.x, rx, 1 - rx), y: clamp(l.y, ry, 1 - ry), r };
}

const withLens = (c: Compare, l: Lens) => (l.x === c.lens.x && l.y === c.lens.y && l.r === c.lens.r ? c : { ...c, lens: l });

/** Drag the lens: its centre to (x, y), kept inside the image. */
export const moveLens = (c: Compare, x: number, y: number, aspect = 1) => withLens(c, fitLens({ ...c.lens, x, y }, aspect));

/** Resize the lens (slider or scroll wheel); near an edge its centre moves in to keep it inside. */
export const resizeLens = (c: Compare, r: number, aspect = 1) => withLens(c, fitLens({ ...c.lens, r }, aspect));

/** The end of a lens drag: only the lens goes on the comparison as it is now (a step may have gone meanwhile). */
export const applyLens = (c: Compare, l: Lens) => withLens(c, l);

/**
 * Show `band` in slot `slot` of the strips' list, where the first `seen` slots are on show.
 * Not a step another shown slot has; a step waiting in a hidden strip swaps places with it.
 */
function setSlot(c: Compare, slot: number, band: Band, seen: number): Compare {
  if (c.bands[slot] === band) return c;
  const j = c.bands.indexOf(band);
  if (j >= 0 && j < seen) return c;
  if (slot >= c.bands.length) return slot === c.bands.length ? addBand(c, band) : c;
  const bands = [...c.bands];
  if (j >= 0) bands[j] = bands[slot]!;
  bands[slot] = band;
  return { ...c, bands };
}

/** The chip for what's under the lens or the boxes. Under the lens, not the step in it. */
export const setUnder = (c: Compare, band: Band) => setSlot(c, 0, band, c.layout === "lens" ? 2 : 1);

/** The chip for what's in the lens (and shift-click, in the lens layout). Not the step under it. */
export const setInLens = (c: Compare, band: Band) => setSlot(c, 1, band, 2);

/* ---------- Boxes ---------- */

/** A box inside the image and at least the smallest size. */
function fitRect(b: Rect): Rect {
  const w = clamp(b.w, MIN_BOX, 1);
  const h = clamp(b.h, MIN_BOX, 1);
  return { x: clamp(b.x, 0, 1 - w), y: clamp(b.y, 0, 1 - h), w, h };
}

/**
 * The box drawn by dragging from (x0, y0) to (x1, y1), either way; a drag off the image stops
 * at its edge. A click (no real drag) makes a default-sized box centred on it.
 */
export function boxRect(x0: number, y0: number, x1: number, y1: number): Rect {
  const a = { x: clamp(x0, 0, 1), y: clamp(y0, 0, 1) };
  const b = { x: clamp(x1, 0, 1), y: clamp(y1, 0, 1) };
  if (Math.abs(b.x - a.x) < CLICK && Math.abs(b.y - a.y) < CLICK) return fitRect({ x: a.x - DEFAULT_BOX / 2, y: a.y - DEFAULT_BOX / 2, w: DEFAULT_BOX, h: DEFAULT_BOX });
  return fitRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
}

/**
 * Add a box showing `step`, at the end (drawn on top). Two boxes may show the same step, and a
 * box may show the step underneath. Six boxes is the most.
 */
export function addBox(c: Compare, rect: Rect, step: Band): Compare {
  if (c.boxes.length >= MAX_BOXES) return c;
  return { ...c, boxes: [...c.boxes, { ...fitRect(rect), step }] };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

function withBox(c: Compare, k: number, rect: Rect): Compare {
  const b = c.boxes[k];
  if (!b || sameRect(b, rect)) return c;
  return { ...c, boxes: c.boxes.map((x, i) => (i === k ? { ...rect, step: x.step } : x)) };
}

/** Drag box `k`: its top-left corner to (x, y), kept inside the image. */
export function moveBox(c: Compare, k: number, x: number, y: number): Compare {
  const b = c.boxes[k];
  return b ? withBox(c, k, { ...b, x: clamp(x, 0, 1 - b.w), y: clamp(y, 0, 1 - b.h) }) : c;
}

/** Resize box `k` from its bottom-right corner to (x, y): not below the smallest size, not past the image. */
export function resizeBox(c: Compare, k: number, x: number, y: number): Compare {
  const b = c.boxes[k];
  return b ? withBox(c, k, { x: b.x, y: b.y, w: clamp(x - b.x, MIN_BOX, 1 - b.x), h: clamp(y - b.y, MIN_BOX, 1 - b.y) }) : c;
}

export function removeBox(c: Compare, k: number): Compare {
  return k >= 0 && k < c.boxes.length ? { ...c, boxes: c.boxes.filter((_, i) => i !== k) } : c;
}

/** A box's chip: show another step (any step: boxes may repeat one). */
export function setBoxStep(c: Compare, k: number, step: Band): Compare {
  const b = c.boxes[k];
  return !b || b.step === step ? c : { ...c, boxes: c.boxes.map((x, i) => (i === k ? { ...x, step } : x)) };
}

/**
 * The end of a move or resize of box `k`: that box, as it was when the drag began (`before`),
 * gets the new place on the comparison as it is now. Boxes are only ever removed, never
 * reordered, so it is at `k` or, if boxes before it went meanwhile, the nearest match below
 * `k`; of two identical boxes, the one dragged. A box removed meanwhile stays removed.
 */
export function applyBox(c: Compare, before: Box, after: Rect, k: number): Compare {
  const same = (i: number) => c.boxes[i]?.step === before.step && sameRect(c.boxes[i]!, before);
  let i = Math.min(k, c.boxes.length - 1);
  while (i >= 0 && !same(i)) i--;
  return i < 0 ? c : withBox(c, i, fitRect(after));
}

/* ---------- Shift-click on a thumbnail ---------- */

/** Where shift-clicked box `n` goes: near the middle, each one a little lower right, so none hides another (up to six, all inside). */
const shiftBox = (n: number): Rect => ({ x: 0.22 + n * 0.08, y: 0.22 + n * 0.08, w: DEFAULT_BOX, h: DEFAULT_BOX });

/** Why shift-clicking `band` changes nothing, or null when it does something. */
export function shiftRefusal(c: Compare, band: Band): string | null {
  if (c.layout === "lens") return c.bands[0] === band ? "That step is already under the lens." : c.bands[1] === band ? "That step is already in the lens." : null;
  if (c.layout === "boxes") return c.boxes.length >= MAX_BOXES ? "Six boxes is the most." : null;
  return c.bands.length >= MAX_STRIPS ? "Six strips is the most." : c.bands.includes(band) ? "That step already has a strip." : null;
}

/**
 * Shift-click on a thumbnail while comparing: side by side or top to bottom it adds a strip;
 * in the lens it sets what's in the lens; with boxes it adds a default-sized box showing that step.
 */
export function shiftAdd(c: Compare, band: Band): Compare {
  if (shiftRefusal(c, band) !== null) return c;
  if (c.layout === "lens") return setInLens(c, band);
  if (c.layout === "boxes") return addBox(c, shiftBox(c.boxes.length), band);
  return addBand(c, band);
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
  // The lens's centre is only brought onto the image here: the image's shape isn't known, so
  // the rest of `fitLens` waits for the canvas (a saved lens comes back where it was).
  const lens = l && num(l.x) && num(l.y) && num(l.r) ? { x: clamp(l.x, 0, 1), y: clamp(l.y, 0, 1), r: clamp(l.r, MIN_LENS, MAX_LENS) } : { ...DEFAULT_LENS };
  const boxes = (Array.isArray(o.boxes) ? o.boxes : [])
    .map(rec)
    .filter((b): b is Record<string, unknown> => !!b && num(b.x) && num(b.y) && num(b.w) && num(b.h) && typeof b.step === "string")
    .slice(0, MAX_BOXES)
    .map((b) => ({ ...fitRect({ x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number }), step: b.step as string }));
  const read: Compare = { layout, bands: strings, splits: splitsFit(s, strings.length) ? [...s] : evenSplits(strings.length), lens, boxes };
  return read.bands.length ? pruneCompare(read, chain) : null;
}
