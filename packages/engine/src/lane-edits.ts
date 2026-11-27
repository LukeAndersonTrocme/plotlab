import { checkChain, removeStep, withStepInks, type ChainResult } from "./chain.ts";
import { isSplitStep, lanesOf, laneIssues, type Lane, type LaneView } from "./lanes.ts";
import { actsPerLayer } from "./layers.ts";
import { defaultParams, type ParamDecl } from "./params.ts";
import { newStepId, type Recipe, type RecipeStep } from "./recipe.ts";
import type { AnyStep, StepRegistry } from "./step.ts";

/**
 * Lane edits (Independent inks, #66): each one changes the one chain (ADR 0009) so that a
 * lane, projected again with `lanesOf`, shows the edit. Each returns the new recipe or a
 * plain-language reason, like the chain operations. Pure: no DOM.
 */

/** Every lane and the chain still fit (`laneIssues` first: its reasons name the ink; then `checkChain`). */
function fits(recipe: Recipe, steps: RecipeStep[], registry: StepRegistry): ChainResult {
  const next = { ...recipe, steps };
  const issue = laneIssues(next, registry)[0] ?? checkChain(recipe.input, steps, registry)[0];
  return issue ? { reason: issue.reason } : { recipe: next };
}

/** Where the lanes end: the stack's first step (or the end of the chain). */
const mergeOf = (v: LaneView, recipe: Recipe) => v.stack[0] ?? recipe.steps.length;

function laneNamed(recipe: Recipe, registry: StepRegistry, layer: string): { view: LaneView; lane: Lane } | { reason: string } {
  const view = lanesOf(recipe, registry);
  if (view.split === null) return { reason: "The picture isn't split into inks, so there are no lanes." };
  const lane = view.lanes.find((l) => l.layer === layer);
  if (!lane) return { reason: `There is no ${layer} lane: the picture isn't split into that ink.` };
  return { view, lane };
}

const title = (registry: StepRegistry, rs: RecipeStep | undefined) => (rs ? (registry.get(rs.step)?.title ?? rs.step) : "That step");

/** Without one layer's own settings (and without an empty `layerParams`). */
function dropOwn(rs: RecipeStep, layer: string): RecipeStep {
  const { [layer]: _, ...rest } = rs.layerParams ?? {};
  const { layerParams: __, ...plain } = rs;
  return Object.keys(rest).length ? { ...plain, layerParams: rest } : plain;
}

/**
 * "+" in lane `layer` at lane gap `at` (0 = right after the split, `lane.steps.length` = at
 * the end of the lane): add `stepId` for that ink only (`layers: [layer]`), at the last chain
 * position between the lane's neighbours where the chain and every lane still fit.
 */
export function addInLane(recipe: Recipe, registry: StepRegistry, layer: string, stepId: string, at: number): { recipe: Recipe; index: number } | { reason: string } {
  const found = laneNamed(recipe, registry, layer);
  if ("reason" in found) return found;
  const { view, lane } = found;
  const def = registry.get(stepId);
  if (!def) return { reason: `Unknown step "${stepId}".` };
  if (!actsPerLayer(def)) return { reason: `${def.title} works on every ink at once, so it can't go in one lane.` };
  if (at < 0 || at > lane.steps.length) return { reason: `There is no place ${at + 1} in the ${layer} lane.` };
  const lo = at === 0 ? view.split! + 1 : lane.steps[at - 1]!.index + 1;
  const hi = at === lane.steps.length ? mergeOf(view, recipe) : lane.steps[at]!.index;
  const fresh: RecipeStep = { id: newStepId(recipe.steps.map((s) => s.id), def.id), step: def.id, version: def.version, params: defaultParams(def.params), enabled: true, layers: [layer] };
  let reason = "";
  // As late as it fits: a slow line step there doesn't hold up the other inks' steps.
  for (let p = hi; p >= lo; p--) {
    const res = fits(recipe, [...recipe.steps.slice(0, p), fresh, ...recipe.steps.slice(p)], registry);
    if ("recipe" in res) return { recipe: withStepInks(res.recipe, def), index: p };
    reason ||= res.reason;
  }
  return { reason: `${def.title} doesn't fit there in the ${layer} lane: ${reason}` };
}

/** The lane step `stepId` in lane `layer`, or why it isn't there. */
function inLane(recipe: Recipe, registry: StepRegistry, stepId: string, layer: string) {
  const found = laneNamed(recipe, registry, layer);
  if ("reason" in found) return found;
  const pos = found.lane.steps.findIndex((s) => s.id === stepId);
  const rs = recipe.steps.find((s) => s.id === stepId);
  if (pos < 0 || !rs) return { reason: `${title(registry, rs)} isn't in the ${layer} lane.` };
  return { ...found, pos, rs, index: found.lane.steps[pos]!.index };
}

/**
 * Take the step `stepId` out of lane `layer`: its selector loses that ink (and the ink's own
 * settings go), or the step goes when that was its only ink.
 */
export function removeFromLane(recipe: Recipe, registry: StepRegistry, stepId: string, layer: string): ChainResult {
  const found = inLane(recipe, registry, stepId, layer);
  if ("reason" in found) return found;
  const { view, rs, index } = found;
  const name = title(registry, rs);
  if (!actsPerLayer(registry.get(rs.step))) return { reason: `${name} works on every ink at once: remove it from the recipe to take it out of every lane.` };
  const left = (Array.isArray(rs.layers) ? rs.layers : view.layers).filter((x) => x !== layer);
  const broke = (reason: string) => ({ reason: `Taking ${name} out of the ${layer} lane would break it: ${reason}` });
  if (left.length === 0) {
    const res = removeStep(recipe, index, registry);
    if ("reason" in res) return res;
    const issue = laneIssues(res.recipe, registry)[0];
    return issue ? broke(issue.reason) : res;
  }
  const res = fits(recipe, recipe.steps.map((s, i) => (i === index ? { ...dropOwn(s, layer), layers: left } : s)), registry);
  return "reason" in res ? broke(res.reason) : res;
}

/**
 * Move the step `stepId` to place `to` in lane `layer` (counted without the step): the first
 * chain position between its new neighbours in that lane where the chain and every lane
 * still fit. A step shared with other lanes moves in those too.
 */
export function moveInLane(recipe: Recipe, registry: StepRegistry, stepId: string, layer: string, to: number): ChainResult {
  const found = inLane(recipe, registry, stepId, layer);
  if ("reason" in found) return found;
  const { view, lane, pos, index: from } = found;
  if (to === pos) return { recipe };
  const others = lane.steps.filter((s) => s.id !== stepId);
  if (to < 0 || to > others.length) return { reason: `There is no place ${to + 1} in the ${layer} lane.` };
  const lo = to === 0 ? view.split! + 1 : others[to - 1]!.index + 1;
  const hi = to === others.length ? mergeOf(view, recipe) : others[to]!.index;
  let reason = "";
  for (let gap = lo; gap <= hi; gap++) {
    if (gap === from || gap === from + 1) continue;
    const steps = [...recipe.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(gap > from ? gap - 1 : gap, 0, moved!);
    const res = fits(recipe, steps, registry);
    if ("recipe" in res) return res;
    reason ||= res.reason;
  }
  return { reason: `${title(registry, found.rs)} can't go there in the ${layer} lane: ${reason || "nothing else would change."}` };
}

/**
 * "Defaults for this step" from lane `layer`: that ink's settings go back to the defaults
 * (written as its own settings, keeping its seed), so the other inks keep theirs.
 */
export function resetLaneStep(recipe: Recipe, registry: StepRegistry, stepId: string, layer: string): ChainResult {
  const found = inLane(recipe, registry, stepId, layer);
  if ("reason" in found) return found;
  const { rs, index } = found;
  const def = registry.get(rs.step)!;
  const mine = found.lane.steps[found.pos]!.params;
  const own: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(def.params as Record<string, ParamDecl>)) own[k] = d.type === "number" && d.seed && mine[k] !== undefined ? mine[k] : d.default;
  const next: RecipeStep = { ...rs, layerParams: { ...rs.layerParams, [layer]: own } };
  return { recipe: { ...recipe, steps: recipe.steps.map((s, i) => (i === index ? next : s)) } };
}

/**
 * "Defaults for this step" for every ink, on a step in the lanes: the shared settings and each
 * ink's own go back to the defaults (keeping the seed), so independent inks stay independent.
 */
export function resetAllInks(recipe: Recipe, registry: StepRegistry, stepId: string): ChainResult {
  const index = recipe.steps.findIndex((s) => s.id === stepId);
  const rs = recipe.steps[index];
  const def = rs && registry.get(rs.step);
  if (!rs || !def) return { reason: `There is no step "${stepId}" in this recipe.` };
  const defaults = (mine: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(def.params as Record<string, ParamDecl>)) out[k] = d.type === "number" && d.seed && mine[k] !== undefined ? mine[k] : d.default;
    return out;
  };
  const own = rs.layerParams && Object.fromEntries(Object.entries(rs.layerParams).map(([l, o]) => [l, Object.keys(o).length ? defaults({ ...rs.params, ...o }) : o]));
  const next: RecipeStep = { ...rs, params: defaults(rs.params), ...(own ? { layerParams: own } : {}) };
  return { recipe: { ...recipe, steps: recipe.steps.map((s, i) => (i === index ? next : s)) } };
}

/** Chain positions of the steps in the lanes (after the split, before the stack). */
const laneRange = (view: LaneView, recipe: Recipe) => ({ from: view.split! + 1, to: mergeOf(view, recipe) });

/**
 * Independent: every ink gets its own copy of the shared settings (per-layer overrides), so
 * each lane shows exactly what it showed before and from now on changes only its ink.
 */
export function unlinkLanes(recipe: Recipe, registry: StepRegistry): ChainResult {
  const view = lanesOf(recipe, registry);
  if (view.split === null) return { reason: "The picture isn't split into inks, so there's nothing to unlink." };
  if (!view.linked) return { reason: "The inks are already independent: each has its own steps and settings." };
  const { from, to } = laneRange(view, recipe);
  const steps = recipe.steps.map((rs, i) => {
    if (i < from || i >= to || !actsPerLayer(registry.get(rs.step))) return rs;
    const own = view.lanes.filter((l) => l.steps.some((s) => s.index === i)).map((l) => [l.layer, { ...rs.params, ...rs.layerParams?.[l.layer] }] as const);
    return { ...rs, layerParams: Object.fromEntries(own) };
  });
  const next = { ...recipe, steps };
  if (lanesOf(next, registry).linked) return { reason: "Nothing to unlink yet: the lanes have no steps with settings. Add a step after the split first." };
  return { recipe: next };
}

const laneSig = (l: Lane) => JSON.stringify(l.steps.map((s) => [s.id, s.enabled, s.params]));

/**
 * What linking onto lane `layer` loses: one line per other lane that differs from it (its
 * steps, and whether it only differs in settings). Empty when nothing is lost.
 */
export function linkLoss(recipe: Recipe, registry: StepRegistry, layer: string): string[] {
  const found = laneNamed(recipe, registry, layer);
  if ("reason" in found) return [];
  const { view, lane } = found;
  const inks = registry.get(recipe.steps[view.split!]!.step)?.layerInks ?? {};
  const sameSteps = (l: Lane) => l.steps.map((s) => s.id).join() === lane.steps.map((s) => s.id).join();
  return view.lanes
    .filter((l) => l.layer !== layer && laneSig(l) !== laneSig(lane))
    .map((l) => {
      const steps = l.steps.length ? l.steps.map((s) => `${registry.get(s.step)?.title ?? s.step}${s.enabled ? "" : " (off)"}`).join(" → ") : "no steps";
      return `${inks[l.layer]?.name ?? l.layer}: ${steps}${sameSteps(l) ? " (its own settings)" : ""}`;
    });
}

/**
 * Linked: every lane becomes lane `layer`. Its steps act on every ink with its settings, and
 * steps it doesn't have go. Lossy (`linkLoss` says what goes), so the app saves a checkpoint first.
 */
export function linkLanes(recipe: Recipe, registry: StepRegistry, layer: string): ChainResult {
  const found = laneNamed(recipe, registry, layer);
  if ("reason" in found) return found;
  const { view, lane } = found;
  if (view.linked) return { reason: "The inks are already linked: one set of steps and settings drives all of them." };
  const { from, to } = laneRange(view, recipe);
  const mine = new Map(lane.steps.map((s) => [s.index, s]));
  const steps = recipe.steps.flatMap((rs, i): RecipeStep[] => {
    if (i < from || i >= to || !actsPerLayer(registry.get(rs.step))) return [rs];
    const s = mine.get(i);
    if (!s) return [];
    const { layers: _l, layerParams: _p, ...plain } = rs;
    return [{ ...plain, params: s.params }];
  });
  const res = fits(recipe, steps, registry);
  return "reason" in res ? { reason: `Linking onto the ${layer} lane would break the chain: ${res.reason}` } : res;
}

/** A step after the split acts on every layer with one set of settings: a single old layer's overrides become the shared ones. */
function onAllLayers(rs: RecipeStep, def: AnyStep | undefined): RecipeStep {
  if (!actsPerLayer(def) || (rs.layers === undefined && rs.layerParams === undefined)) return rs;
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
