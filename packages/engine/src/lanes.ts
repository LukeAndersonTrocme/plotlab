import type { ChainResult } from "./chain.ts";
import { actsPerLayer } from "./layers.ts";
import { screenAngle } from "./project.ts";
import type { Recipe, RecipeStep } from "./recipe.ts";
import type { AnyStep, StepRegistry } from "./step.ts";

/**
 * Lanes (#66): a view of one chain, never a recipe tree (ADR 0009). A split (Separate CMYK)
 * makes named layers; each layer's lane is the steps after it whose layer selector includes
 * that layer, with `params` merged with `layerParams[layer]`. The stack is where the lanes
 * merge into one plot. Pure: no DOM, tested on its own.
 */

/** One step as a lane sees it. */
export interface LaneStep {
  /** Chain position. */
  index: number;
  /** The step's stable id (`RecipeStep.id`). */
  id: string;
  step: string;
  enabled: boolean;
  /** The settings this lane runs with: shared `params` plus this layer's overrides. */
  params: Record<string, unknown>;
  /** True when this lane uses the shared settings as they are (no override for its layer). */
  shared: boolean;
}

export interface Lane {
  /** Layer id (C, M, Y, K for Separate CMYK). */
  layer: string;
  steps: LaneStep[];
  /** No step in the lanes narrows its selector or overrides this layer's settings. */
  linked: boolean;
}

export interface LaneView {
  /** Chain positions before the split (the whole chain when there is no split). */
  trunk: number[];
  /** Chain position of the split step, or null when the chain isn't split into lanes. */
  split: number | null;
  /** The layers the split makes, in its order. */
  layers: string[];
  /** One lane per layer (empty without a split). */
  lanes: Lane[];
  /** Chain positions from the merge on: the first switched-on step that makes the plot, to the end. */
  stack: number[];
  /** Every lane is linked: one set of steps and settings drives all the inks. */
  linked: boolean;
}

/** A step that splits the picture into named layers: image → layers, declaring its layers (by their default inks). */
export function isSplitStep(def: AnyStep | undefined): boolean {
  return !!def && def.input === "image" && def.output === "layers" && Object.keys(def.layerInks ?? {}).length > 1;
}

const nonEmpty = (o: Record<string, unknown> | undefined) => !!o && Object.keys(o).length > 0;
const narrowed = (rs: RecipeStep) => Array.isArray(rs.layers);

export function lanesOf(recipe: Recipe, registry: StepRegistry): LaneView {
  const steps = recipe.steps;
  const all = steps.map((_, i) => i);
  const split = recipe.input === "image" ? steps.findIndex((rs) => rs.enabled !== false && isSplitStep(registry.get(rs.step))) : -1;
  if (split < 0) return { trunk: all, split: null, layers: [], lanes: [], stack: [], linked: true };
  const layers = Object.keys(registry.get(steps[split]!.step)!.layerInks!);
  let merge = steps.findIndex((rs, i) => i > split && rs.enabled !== false && registry.get(rs.step)?.output === "plot");
  if (merge < 0) merge = steps.length;
  const inLanes = all.slice(split + 1, merge);
  // Steps that act per layer (layer steps, and Fill) take a selector and per-layer settings;
  // any other whole-stage step is in every lane with its shared settings.
  const layerActing = (rs: RecipeStep) => actsPerLayer(registry.get(rs.step));
  const unlinkedAll = inLanes.some((i) => layerActing(steps[i]!) && narrowed(steps[i]!));
  const lanes = layers.map((layer): Lane => {
    const laneSteps: LaneStep[] = [];
    let overridden = false;
    for (const i of inLanes) {
      const rs = steps[i]!;
      const acting = layerActing(rs);
      if (acting && narrowed(rs) && !(rs.layers as string[]).includes(layer)) continue;
      const own = acting ? rs.layerParams?.[layer] : undefined;
      if (nonEmpty(own)) overridden = true;
      laneSteps.push({ index: i, id: rs.id, step: rs.step, enabled: rs.enabled !== false, params: { ...rs.params, ...own }, shared: !nonEmpty(own) });
    }
    return { layer, steps: laneSteps, linked: !unlinkedAll && !overridden };
  });
  return { trunk: all.slice(0, split), split, layers, lanes, stack: all.slice(merge), linked: lanes.every((l) => l.linked) };
}

/**
 * Change one setting of the step `stepId` from a lane. A linked edit (or `lane` null: the
 * shared settings) writes the step's `params` once; an edit in an independent lane (one with
 * its own selector or settings) writes that layer's `layerParams` entry. A step that isn't
 * in the named lane (a trunk step, or one narrowed to other inks) is refused. With no lane, on
 * a step in the lanes, it is every ink: the shared setting and each ink's own copy of it.
 */
export function setLaneParam(recipe: Recipe, registry: StepRegistry, stepId: string, name: string, value: unknown, lane: string | null): ChainResult {
  const index = recipe.steps.findIndex((s) => s.id === stepId);
  const rs = recipe.steps[index];
  const def = rs && registry.get(rs.step);
  if (!rs || !def) return { reason: `There is no step "${stepId}" in this recipe.` };
  if (!(name in def.params)) return { reason: `${def.title} has no setting "${name}".` };
  let own = false;
  if (lane !== null) {
    const l = lanesOf(recipe, registry).lanes.find((x) => x.layer === lane);
    if (!l) return { reason: `There is no ${lane} lane: the picture isn't split into that ink.` };
    if (!l.steps.some((x) => x.id === stepId)) return { reason: `${def.title} isn't in the ${lane} lane, so it can't be changed from there.` };
    // The lane's own state: a lane with its own settings keeps them; a linked lane edits the shared ones.
    own = actsPerLayer(def) && !l.linked;
  }
  let next: RecipeStep = own && lane !== null
    ? { ...rs, layerParams: { ...rs.layerParams, [lane]: { ...rs.layerParams?.[lane], [name]: value } } }
    : { ...rs, params: { ...rs.params, [name]: value } };
  // No lane, on a step in the lanes of a split picture: every ink. An ink's own copy of this
  // setting (Independent) would hide the shared one, so it changes too.
  if (lane === null && actsPerLayer(def) && rs.layerParams && lanesOf(recipe, registry).lanes.some((l) => l.steps.some((x) => x.id === stepId))) {
    const layerParams = Object.fromEntries(Object.entries(rs.layerParams).map(([l, o]) => [l, name in o ? { ...o, [name]: value } : o]));
    next = { ...next, layerParams };
  }
  return { recipe: { ...recipe, steps: recipe.steps.map((s, i) => (i === index ? next : s)) } };
}

/** Print screen angles by layer (glossary: screen angle), so the inks don't all hatch the same way. */
export const PRINT_SCREEN_ANGLES: Record<string, number> = { C: 15, M: 75, Y: 0, K: 45 };

/** A layer's print screen angle: its CMYK angle, else the classic angle for its position (`screenAngle`). */
export function printScreenAngle(layerId: string, index: number): number {
  return screenAngle({ lpi: 0, angles: PRINT_SCREEN_ANGLES }, layerId, index);
}

export interface LaneIssue {
  layer: string;
  /** Chain position of the step that doesn't fit in that lane. */
  index: number;
  reason: string;
}

/**
 * Each lane on its own (Independent inks): a layer step needs its ink still to be layers, and
 * a lines step that acts per layer (Fill) needs it to be lines. Either one in the wrong place
 * would do nothing for that ink, so the lane wouldn't show what the ink gets. `checkChain`
 * checks the chain as a whole.
 */
export function laneIssues(recipe: Recipe, registry: StepRegistry): LaneIssue[] {
  const issues: LaneIssue[] = [];
  for (const lane of lanesOf(recipe, registry).lanes) {
    let lines: string | null = null;
    for (const s of lane.steps) {
      const def = registry.get(s.step);
      if (!s.enabled || !def) continue;
      if (def.runLayer && lines !== null) {
        issues.push({ layer: lane.layer, index: s.index, reason: `${def.title} needs ${lane.layer} as layers, but in the ${lane.layer} lane it's already lines (after ${lines}). Take ${lines} out of the ${lane.layer} lane first, or put ${def.title} before it.` });
        break;
      }
      // A lines step that acts per layer (Fill) would do nothing for an ink that isn't lines yet.
      if (!def.runLayer && def.linesPerLayer && lines === null) {
        issues.push({ layer: lane.layer, index: s.index, reason: `${def.title} works on ${lane.layer}'s lines, but in the ${lane.layer} lane it isn't lines yet. Take ${def.title} out of the ${lane.layer} lane first, or give the lane a line step (like Centerline) before it.` });
        break;
      }
      if (def.runLayer && def.output === "geometry") lines = def.title;
    }
  }
  return issues;
}

/**
 * A lane issue that `after` has and `before` didn't (matched by ink and step id): what a
 * whole-chain edit (move, add, remove, switch off) would break in one ink's lane. Issues a
 * recipe already had (an older recipe) don't block other edits. Null when nothing new breaks.
 */
export function newLaneIssue(before: Recipe, after: Recipe, registry: StepRegistry): LaneIssue | null {
  if (lanesOf(after, registry).split === null) return null;
  const key = (r: Recipe, i: LaneIssue) => `${i.layer}|${r.steps[i.index]?.id}`;
  const had = new Set(laneIssues(before, registry).map((i) => key(before, i)));
  return laneIssues(after, registry).find((i) => !had.has(key(after, i))) ?? null;
}
