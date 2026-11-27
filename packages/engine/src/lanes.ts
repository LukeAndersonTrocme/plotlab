import { checkChain, withStepInks, type ChainResult } from "./chain.ts";
import { defaultParams } from "./params.ts";
import { screenAngle } from "./project.ts";
import { newStepId, type Recipe, type RecipeStep } from "./recipe.ts";
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
  // Only layer-acting steps take a selector and per-layer settings; whole-stage steps (Fill,
  // which works on every layer's lines alike) are in every lane with their shared settings.
  const layerActing = (rs: RecipeStep) => !!registry.get(rs.step)?.runLayer;
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
 * in the named lane (a trunk step, or one narrowed to other inks) is refused.
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
    own = !!def.runLayer && !l.linked;
  }
  const next: RecipeStep = own && lane !== null
    ? { ...rs, layerParams: { ...rs.layerParams, [lane]: { ...rs.layerParams?.[lane], [name]: value } } }
    : { ...rs, params: { ...rs.params, [name]: value } };
  return { recipe: { ...recipe, steps: recipe.steps.map((s, i) => (i === index ? next : s)) } };
}

/** A step after the split acts on every layer with one set of settings: a single old layer's overrides become the shared ones. */
function onAllLayers(rs: RecipeStep, def: AnyStep | undefined): RecipeStep {
  if (!def?.runLayer || (rs.layers === undefined && rs.layerParams === undefined)) return rs;
  const { layers: _l, layerParams, ...rest } = rs;
  const folded = Object.values(layerParams ?? {}).reduce<Record<string, unknown>>((p, o) => ({ ...p, ...o }), {});
  return { ...rest, params: { ...rs.params, ...folded } };
}

/**
 * Split the picture into layers with the step `stepId` (Separate CMYK) at `gap`, or where
 * the chain makes its layers now. It takes the place of the step that made the layers
 * (Ink density, Threshold…); the layer steps after it act on every new layer with their
 * shared settings (linked), the split's inks are added, and print screen angles go on.
 * Image steps before it stay in the trunk.
 */
export function splitWith(
  recipe: Recipe,
  stepId: string,
  registry: StepRegistry,
  gap?: number,
): { recipe: Recipe; index: number; replaced: string | null } | { reason: string } {
  const def = registry.get(stepId);
  if (!def) return { reason: `Unknown step "${stepId}".` };
  if (!isSplitStep(def)) return { reason: `${def.title} doesn't split the picture into layers.` };
  if (recipe.input !== "image") return { reason: `${def.title} splits a picture, but this source doesn't enter as a picture.` };
  const view = lanesOf(recipe, registry);
  if (view.split !== null) return { reason: `The picture is already split into ${view.layers.join(", ")}. Undo the split first.` };
  if (recipe.steps.some((rs) => rs.step === def.id && rs.enabled === false)) {
    return { reason: `${def.title} is already in the recipe, switched off. Switch it back on (its ● in the strip) instead of adding another.` };
  }
  const makesLayers = (rs: RecipeStep) => {
    const d = registry.get(rs.step);
    return rs.enabled !== false && d?.input === "image" && d.output === "layers";
  };
  const firstMaker = recipe.steps.findIndex(makesLayers);
  const positions = gap !== undefined ? [gap] : firstMaker >= 0 ? [firstMaker] : [...Array(recipe.steps.length + 1).keys()];
  let reason = "";
  for (const at of positions) {
    const old = recipe.steps.findIndex((rs, i) => i >= at && makesLayers(rs));
    const kept = recipe.steps.filter((_, i) => i !== old);
    const fresh: RecipeStep = { id: newStepId(kept.map((s) => s.id), def.id), step: def.id, version: def.version, params: defaultParams(def.params), enabled: true };
    const steps = [...kept.slice(0, at), fresh, ...kept.slice(at).map((rs) => onAllLayers(rs, registry.get(rs.step)))];
    const issue = checkChain(recipe.input, steps, registry)[0];
    if (issue) {
      reason ||= issue.reason;
      continue;
    }
    const replaced = old >= 0 ? (registry.get(recipe.steps[old]!.step)?.title ?? recipe.steps[old]!.step) : null;
    return { recipe: { ...withStepInks({ ...recipe, steps }, def), screenAngles: true }, index: at, replaced };
  }
  return { reason: `${def.title} doesn't fit here: ${reason}` };
}

/** Print screen angles by layer (glossary: screen angle), so the inks don't all hatch the same way. */
export const PRINT_SCREEN_ANGLES: Record<string, number> = { C: 15, M: 75, Y: 0, K: 45 };

/** A layer's print screen angle: its CMYK angle, else the classic angle for its position (`screenAngle`). */
export function printScreenAngle(layerId: string, index: number): number {
  return screenAngle({ lpi: 0, angles: PRINT_SCREEN_ANGLES }, layerId, index);
}
