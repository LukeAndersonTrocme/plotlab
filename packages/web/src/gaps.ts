import { checkChain, insertStep, isSplitStep, moveStep, splitWith, STAGE_WORDS, type ChainResult, type Recipe, type StageKind, type StepRegistry } from "@plotlab/engine";
import { stepIcon } from "./strip.ts";

/**
 * The gaps between strip boxes (#66): "+" adds a step there, and a dragged box drops into
 * one. Gap `g` sits just before chain position `g`: gap 0 is right after the source, gap
 * `steps.length` is after the last step. Pure, so the rules are tested without a browser;
 * the chain rules themselves are the engine's (ADR 0009).
 */

/** What the chain has at a gap: the entry stage, changed by each switched-on step before it. */
export function stageAt(recipe: Recipe, registry: StepRegistry, gap: number): StageKind {
  let stage = recipe.input;
  for (const rs of recipe.steps.slice(0, gap)) {
    if (rs.enabled === false) continue;
    const def = registry.get(rs.step);
    if (def) stage = def.output as StageKind;
  }
  return stage;
}

export interface AddOption {
  id: string;
  title: string;
  icon: string;
  summary: string;
  output: StageKind;
  experimental: boolean;
  /** Adding it splits the picture into inks (Separate CMYK): the steps after it apply to every ink. */
  split: boolean;
}

export interface AddMenu {
  /** What the chain has at this gap. */
  stage: StageKind;
  /** The steps that keep the chain valid here. */
  options: AddOption[];
  /** Why nothing fits, when nothing does. */
  reason: string | null;
}

const ORDER = "Each step turns one kind of data into the next: an image → layers → lines → a plot.";

/**
 * Add a step at `gap`. A step that splits the picture into inks (Separate CMYK) splits it
 * (`splitWith`): it takes the place of the step that made the layers, and the steps after it
 * apply to every ink. Any other step goes in as it is (`insertStep`).
 */
function place(recipe: Recipe, registry: StepRegistry, gap: number, stepId: string): { recipe: Recipe; index: number; split: boolean } | { reason: string } {
  if (isSplitStep(registry.get(stepId))) {
    const res = splitWith(recipe, stepId, registry, gap);
    return "reason" in res ? res : { recipe: res.recipe, index: res.index, split: true };
  }
  const res = insertStep(recipe, stepId, registry, gap);
  return "reason" in res ? res : { ...res, split: false };
}

/** The steps a "+" at `gap` offers: exactly those that can go there (`addAt` accepts). */
export function addMenu(recipe: Recipe, registry: StepRegistry, gap: number): AddMenu {
  const stage = stageAt(recipe, registry, gap);
  const options: AddOption[] = registry
    .list()
    .filter((def) => "recipe" in place(recipe, registry, gap, def.id))
    .map((def) => ({
      id: def.id,
      title: def.title,
      icon: stepIcon(def.id),
      summary: def.summary,
      output: def.output as StageKind,
      experimental: Boolean(def.experimental),
      split: isSplitStep(def),
    }));
  if (options.length) return { stage, options, reason: null };
  const issue = checkChain(recipe.input, recipe.steps, registry)[0];
  if (issue) return { stage, options, reason: `Nothing fits here until the chain fits together: ${issue.reason}` };
  const takes = registry.list().some((d) => d.input === stage);
  const reason = takes
    ? `Nothing fits here: at this point the chain has ${STAGE_WORDS[stage]}, and no step that works on ${STAGE_WORDS[stage]} keeps the steps after it working. ${ORDER}`
    : `Nothing fits here: at this point the chain has ${STAGE_WORDS[stage]}, and no step works on ${STAGE_WORDS[stage]}. ${ORDER}`;
  return { stage, options, reason };
}

/**
 * Add a step at `gap` (default settings and inks); `id` is the new step's stable id. `split`:
 * it split the picture into inks (the app saves a checkpoint first, as for "Split into CMYK").
 */
export function addAt(recipe: Recipe, registry: StepRegistry, gap: number, stepId: string): { recipe: Recipe; id: string; split: boolean } | { reason: string } {
  const res = place(recipe, registry, gap, stepId);
  if ("reason" in res) return res;
  return { recipe: res.recipe, id: res.recipe.steps[res.index]!.id, split: res.split };
}

/** Move the step at `from` into `gap` (the gap's index is counted before the move). */
export function moveToGap(recipe: Recipe, registry: StepRegistry, from: number, gap: number): ChainResult {
  return moveStep(recipe, from, gap > from ? gap - 1 : gap, registry);
}

export interface DropGap {
  gap: number;
  ok: boolean;
  /** Why the step can't go here. */
  reason?: string;
}

/** Every gap a dragged step could land in, except the two beside it (no change), and whether it fits there. */
export function dropGaps(recipe: Recipe, registry: StepRegistry, from: number): DropGap[] {
  const gaps: DropGap[] = [];
  for (let gap = 0; gap <= recipe.steps.length; gap++) {
    if (gap === from || gap === from + 1) continue;
    const res = moveToGap(recipe, registry, from, gap);
    gaps.push("reason" in res ? { gap, ok: false, reason: res.reason } : { gap, ok: true });
  }
  return gaps;
}

/** The hint while dragging the step at `from`: how many places it can go, or why none. */
export function dragHint(recipe: Recipe, registry: StepRegistry, from: number): string {
  const rs = recipe.steps[from];
  const def = rs && registry.get(rs.step);
  const title = def?.title ?? rs?.step ?? "This step";
  const n = dropGaps(recipe, registry, from).filter((g) => g.ok).length;
  if (n) return `${title} can go in ${n} other ${n === 1 ? "place: the highlighted gap" : "places: the highlighted gaps"}.`;
  if (!def) return `${title} has nowhere else to go.`;
  const input = def.input as StageKind, output = def.output as StageKind;
  const does = input === output ? `it works on ${STAGE_WORDS[input]}` : `it turns ${STAGE_WORDS[input]} into ${STAGE_WORDS[output]}`;
  return `${title} has nowhere else to go: ${does}, and only fits where the chain has ${STAGE_WORDS[input]}.`;
}
