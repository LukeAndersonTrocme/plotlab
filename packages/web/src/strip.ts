import { checkChain, lanesOf, removeStep, STAGE_WORDS, type ChainResult, type Recipe, type StageKind, type StepRegistry } from "@plotlab/engine";

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

export function stripBoxes(recipe: Recipe, registry: StepRegistry, run: { steps: ReadonlyArray<{ index: number }>; stale: readonly number[] }): StripBox[] {
  const ran = new Set(run.steps.map((s) => s.index));
  const firstStale = run.stale.length ? Math.min(...run.stale) : Infinity;
  const lanes = lanesOf(recipe, registry);
  const merge = lanes.stack[0] ?? recipe.steps.length;
  const laneAt = (i: number): StripBox["lane"] => (lanes.split === null ? null : i === lanes.split ? "split" : i > lanes.split && i < merge ? "lane" : null);
  const boxes: StripBox[] = [
    { key: "source", index: -1, title: "Source", icon: SOURCE_ICON, input: recipe.input, output: recipe.input, enabled: true, status: "ran", bypass: null, lane: null },
  ];
  recipe.steps.forEach((rs, index) => {
    const def = registry.get(rs.step);
    const title = def?.title ?? rs.step;
    const input = (def?.input ?? "image") as StageKind;
    const output = (def?.output ?? input) as StageKind;
    const enabled = rs.enabled !== false;
    const status: BoxStatus = !enabled ? "off" : ran.has(index) ? "ran" : index >= firstStale ? "waiting" : "none";
    const bypass =
      input === output || !enabled
        ? { ok: true as const }
        : {
            ok: false as const,
            reason: `Can't switch off ${title} here: it turns ${STAGE_WORDS[input]} into ${STAGE_WORDS[output]}. Only steps that keep the same kind of data can be switched off.`,
          };
    boxes.push({ key: rs.id, index, title, icon: stepIcon(rs.step), input, output, enabled, status, bypass, lane: laneAt(index) });
  });
  return boxes;
}

/**
 * Switch a step off (bypass) or back on: the strip's toggle and the sidebar's Switch off both
 * use this. Steps that change stage can't be switched off; nor can a step go on where it doesn't fit.
 */
export function toggleBypass(recipe: Recipe, index: number, registry: StepRegistry): ChainResult {
  const rs = recipe.steps[index];
  const def = rs && registry.get(rs.step);
  if (!rs || !def) return { reason: `There is no step ${index + 1}.` };
  const box = stripBoxes(recipe, registry, { steps: [], stale: [] })[index + 1]!;
  if (box.bypass && !box.bypass.ok) return { reason: box.bypass.reason };
  const on = rs.enabled === false;
  const steps = recipe.steps.map((s, i) => (i === index ? { ...s, enabled: on, offForEntry: undefined } : s));
  const issue = checkChain(recipe.input, steps, registry)[0];
  if (issue) return { reason: `${on ? "Turning on" : "Switching off"} ${def.title} would break the chain: ${issue.reason}` };
  return { recipe: { ...recipe, steps } };
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
