import { lanesOf, removeStep, validated, STAGE_WORDS, type ChainResult, type Recipe, type StageKind, type StepRegistry } from "@plotlab/engine";

/**
 * The step strip (#66): one box per step plus the source, each showing a thumbnail of that
 * step's output. Pure, so the rules are tested without a browser; `Strip.tsx` renders it.
 */

/** Stage names in the UI (glossary: Image, Layers, Lines, Plot). */
export const STAGE_NAMES: Record<StageKind, string> = { image: "Image", layers: "Layers", geometry: "Lines", plot: "Plot" };
export const STAGES: StageKind[] = ["image", "layers", "geometry", "plot"];

/** A small sign per step, beside its name. Steps without one get a dot. */
const ICONS: Record<string, string> = {
  tone: "◐",
  threshold: "◑",
  levels: "≡",
  pixelate: "▦",
  dither: "⁙",
  reaction: "∿",
  cmyk: "◧",
  cells: "▩",
  bands: "◎",
  centerline: "⌇",
  stipple: "⁘",
  fill: "▤",
  order: "↝",
};
/** The drag data a strip box carries: its step id. The sidebar takes it to pin that step. */
export const STEP_DRAG = "application/x-plotlab-step";

export const SOURCE_ICON = "▣";
export const stepIcon = (step: string) => ICONS[step] ?? "•";

/**
 * ran: shows its own output. off: switched off, shows what passes through. waiting: an
 * on-demand step that hasn't run (or a step after one), shows traced order. none: not
 * reached (an error earlier).
 */
export type BoxStatus = "ran" | "off" | "waiting" | "none";

export interface StripBox {
  /** "source", or the step id: the box's thumbnail and selection key. */
  key: string;
  /** Chain position; -1 for the source. */
  index: number;
  title: string;
  icon: string;
  input: StageKind;
  output: StageKind;
  enabled: boolean;
  status: BoxStatus;
  /**
   * Whether the bypass toggle works here, and why not; null for the source (it has none).
   * A stage-changing step can't be switched off, but one that is off can be tried back on.
   */
  bypass: { ok: true } | { ok: false; reason: string } | null;
  /**
   * In a split chain (CMYK lanes): "split" for the step that splits the picture, "lane" for the
   * steps in the lanes. Both show each ink as a 2×2 thumbnail. null elsewhere.
   */
  lane: "split" | "lane" | null;
}

/**
 * The Stack box's key (thumbnail and selection): all the inks together, where the lanes merge.
 * "@" can't start a step id (ids are made from step names), so it never clashes with one.
 */
export const STACK_KEY = "@stack";

/** The lane row of a split chain: which inks, whether they're linked, and where the Stack box goes. */
export interface StripLanes {
  /** Layer ids, in the 2×2's order (C top left, M, Y, K). */
  layers: string[];
  names: string[];
  linked: boolean;
  /** Chain position of the last step in the lanes: the Stack box (all inks together) comes after it. */
  stackAfter: number;
  /** The recipe's print screen angles switch. */
  screenAngles: boolean;
}

/** The lane row, or null when the chain isn't split (a view of one chain: `lanesOf`, ADR 0009). */
export function stripLanes(recipe: Recipe, registry: StepRegistry): StripLanes | null {
  const v = lanesOf(recipe, registry);
  if (v.split === null) return null;
  const inks = registry.get(recipe.steps[v.split]!.step)?.layerInks ?? {};
  return {
    layers: v.layers,
    names: v.layers.map((l) => inks[l]?.name ?? l),
    linked: v.linked,
    stackAfter: (v.stack[0] ?? recipe.steps.length) - 1,
    screenAngles: recipe.screenAngles === true,
  };
}

/**
 * The last run, as the strip reads it: which steps ran and which on-demand steps are stale,
 * by step id. Ids, not places, so right after a reorder (before the next run) each box keeps
 * its own status rather than the one of the step that used to be at its place.
 */
export interface StripRun {
  steps: ReadonlyArray<{ id: string }>;
  staleIds: readonly string[];
}

export function stripBoxes(recipe: Recipe, registry: StepRegistry, run: StripRun): StripBox[] {
  const ran = new Set(run.steps.map((s) => s.id));
  const staleIds = new Set(run.staleIds);
  const lanes = lanesOf(recipe, registry);
  const merge = lanes.stack[0] ?? recipe.steps.length;
  const laneAt = (i: number): StripBox["lane"] => (lanes.split === null ? null : i === lanes.split ? "split" : i > lanes.split && i < merge ? "lane" : null);
  const boxes: StripBox[] = [
    { key: "source", index: -1, title: "Source", icon: SOURCE_ICON, input: recipe.input, output: recipe.input, enabled: true, status: "ran", bypass: null, lane: null },
  ];
  /** A stale step has come at or before this place (in the chain as it is now). */
  let waiting = false;
  recipe.steps.forEach((rs, index) => {
    const def = registry.get(rs.step);
    const title = def?.title ?? rs.step;
    const input = (def?.input ?? "image") as StageKind;
    const output = (def?.output ?? input) as StageKind;
    const enabled = rs.enabled !== false;
    waiting ||= staleIds.has(rs.id);
    const status: BoxStatus = !enabled ? "off" : ran.has(rs.id) ? "ran" : waiting ? "waiting" : "none";
    boxes.push({ key: rs.id, index, title, icon: stepIcon(rs.step), input, output, enabled, status, bypass: bypassRule(recipe, index, registry), lane: laneAt(index) });
  });
  return boxes;
}

/**
 * Switch a step off (bypass) or back on: the one rule behind the strip's toggle and the
 * sidebar's checkbox and Switch off (`bypassRule`). A stage-changing step can't be switched off
 * (Stroke order included: it turns lines into a plot), but one that is off can be tried back on;
 * either way the chain, and every ink's lane, must still fit.
 */
export function toggleBypass(recipe: Recipe, index: number, registry: StepRegistry): ChainResult {
  const rs = recipe.steps[index];
  const def = rs && registry.get(rs.step);
  if (!rs || !def) return { reason: `There is no step ${index + 1}.` };
  const on = rs.enabled === false;
  const input = def.input as StageKind, output = def.output as StageKind;
  if (input !== output && !on) {
    return { reason: `Can't switch off ${def.title} here: it turns ${STAGE_WORDS[input]} into ${STAGE_WORDS[output]}. Only steps that keep the same kind of data can be switched off.` };
  }
  const steps = recipe.steps.map((s, i) => (i === index ? { ...s, enabled: on, offForEntry: undefined } : s));
  return validated(recipe, steps, registry, `${on ? "Turning on" : "Switching off"} ${def.title} would break the chain: `);
}

/** Whether the bypass toggle works on the step at `index`, and why not (`toggleBypass`'s rule). */
export function bypassRule(recipe: Recipe, index: number, registry: StepRegistry): { ok: true } | { ok: false; reason: string } {
  const res = toggleBypass(recipe, index, registry);
  return "reason" in res ? { ok: false, reason: res.reason } : { ok: true };
}

/** Whether Remove works on the step at `index`, and why not (it would break the chain). */
export function removeCheck(recipe: Recipe, index: number, registry: StepRegistry): { ok: true } | { ok: false; reason: string } {
  const res = removeStep(recipe, index, registry);
  return "reason" in res ? { ok: false, reason: res.reason } : { ok: true };
}

/**
 * Which step's output a box at chain position `index` shows: its own if it ran, else what
 * passes through it (the last step before it that ran). -1 = the placed source.
 */
export function shownAt(index: number, ran: readonly number[]): number {
  let best = -1;
  for (const i of ran) if (i <= index && i > best) best = i;
  return best;
}

/** Pixel size to render thumbnails at: the box at the screen's density, rounded up to a multiple of 32 (so renders get reused). */
export function thumbRenderSide(boxPx: number, devicePixelRatio: number): number {
  const px = Math.ceil((boxPx * Math.max(1, devicePixelRatio)) / 32) * 32;
  return Math.min(400, Math.max(64, px));
}
