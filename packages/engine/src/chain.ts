import { defaultParams } from "./params.ts";
import type { Recipe, RecipeStep } from "./recipe.ts";
import type { StepRegistry } from "./step.ts";
import type { StageKind } from "./types.ts";

/**
 * Chain rules for reordering, adding and removing steps (ADR 0009). Steps may go
 * anywhere the data types allow; anything else gets a plain-language reason.
 */
export const STAGE_WORDS: Record<StageKind, string> = { image: "an image", layers: "layers", geometry: "lines", plot: "a plot" };

export interface ChainIssue {
  index: number;
  reason: string;
}

export type ChainResult = { recipe: Recipe } | { reason: string };

function advice(needs: StageKind, input: StageKind, registry: StepRegistry): string {
  if (needs === input) return `Move it earlier, while the chain still has ${STAGE_WORDS[needs]}.`;
  const maker = registry.list().find((s) => s.output === needs && s.input !== needs);
  return `Put it after a step that makes ${STAGE_WORDS[needs]}${maker ? `, like ${maker.title}` : ""}.`;
}

/** Every place an enabled step receives the wrong kind of data. */
export function checkChain(input: StageKind, steps: RecipeStep[], registry: StepRegistry): ChainIssue[] {
  const issues: ChainIssue[] = [];
  let current = input;
  steps.forEach((rs, index) => {
    if (rs.enabled === false) return;
    const def = registry.get(rs.step);
    if (!def) {
      issues.push({ index, reason: `Unknown step "${rs.step}".` });
      return;
    }
    const needs = def.input as StageKind;
    if (needs !== current) {
      issues.push({
        index,
        reason: `${def.title} needs ${STAGE_WORDS[needs]}, but at that point the chain has ${STAGE_WORDS[current]}. ${advice(needs, input, registry)}`,
      });
    }
    current = def.output as StageKind;
  });
  return issues;
}

function validated(recipe: Recipe, steps: RecipeStep[], registry: StepRegistry, prefix = ""): ChainResult {
  const issues = checkChain(recipe.input, steps, registry);
  if (issues.length) return { reason: prefix + issues[0]!.reason };
  return { recipe: { ...recipe, steps } };
}

/** Move the step at `from` so it ends up at index `to`. */
export function moveStep(recipe: Recipe, from: number, to: number, registry: StepRegistry): ChainResult {
  const steps = [...recipe.steps];
  const [moved] = steps.splice(from, 1);
  if (!moved) return { reason: `There is no step ${from + 1}.` };
  steps.splice(Math.max(0, Math.min(to, steps.length)), 0, moved);
  return validated(recipe, steps, registry);
}

/** Add a step with default params at `at`, or at the first place it fits. */
export function insertStep(
  recipe: Recipe,
  stepId: string,
  registry: StepRegistry,
  at?: number,
): { recipe: Recipe; index: number } | { reason: string } {
  const def = registry.get(stepId);
  if (!def) return { reason: `Unknown step "${stepId}".` };
  const fresh: RecipeStep = { step: def.id, version: def.version, params: defaultParams(def.params), enabled: true };
  const positions = at === undefined ? [...Array(recipe.steps.length + 1).keys()] : [at];
  let reason = "";
  for (const i of positions) {
    const steps = [...recipe.steps];
    steps.splice(i, 0, fresh);
    const res = validated(recipe, steps, registry);
    if ("recipe" in res) return { recipe: res.recipe, index: i };
    reason ||= res.reason;
  }
  // Prefer the reason about the new step itself (it's the one the person is placing).
  const end = [...recipe.steps, fresh];
  const own = checkChain(recipe.input, end, registry).find((x) => x.index === end.length - 1);
  return { reason: own?.reason ?? reason };
}

export function removeStep(recipe: Recipe, index: number, registry: StepRegistry): ChainResult {
  const def = registry.get(recipe.steps[index]?.step ?? "");
  const steps = recipe.steps.filter((_, i) => i !== index);
  return validated(recipe, steps, registry, `Removing ${def?.title ?? "this step"} would break the chain: `);
}

const RANK: Record<StageKind, number> = { image: 0, layers: 1, geometry: 2, plot: 3 };

export interface EntryResult {
  recipe: Recipe;
  /** True when the entry stage changed. */
  changed: boolean;
  /** Titles of steps switched off because they come before the new entry stage. */
  switchedOff: string[];
  /** Titles of leading steps switched back on because the source now enters earlier. */
  switchedOn: string[];
  /** What still doesn't fit (plain language), if anything. */
  issues: ChainIssue[];
}

/**
 * Set the chain's entry stage to where a new source enters (an SVG enters as lines,
 * multi-page TIFF separations as layers). Leading steps that belong before that stage are
 * switched off, not removed, and marked `offForEntry`; marked steps are switched back on when a
 * source enters earlier again. Steps switched off by hand are never touched.
 */
export function enterAt(recipe: Recipe, stage: StageKind, registry: StepRegistry): EntryResult {
  if (recipe.input === stage) return { recipe, changed: false, switchedOff: [], switchedOn: [], issues: checkChain(stage, recipe.steps, registry) };
  const steps = recipe.steps.map((s) => ({ ...s }));
  const title = (s: RecipeStep) => registry.get(s.step)?.title ?? s.step;
  const rankOf = (s: RecipeStep) => RANK[(registry.get(s.step)?.input ?? "plot") as StageKind];
  const switchedOff: string[] = [];
  const switchedOn: string[] = [];
  if (RANK[stage] > RANK[recipe.input]) {
    for (const s of steps) {
      if (s.enabled === false) continue;
      if (!registry.get(s.step) || rankOf(s) >= RANK[stage]) break;
      s.enabled = false;
      s.offForEntry = true;
      switchedOff.push(title(s));
    }
  } else {
    // Only steps this function switched off, and only those that belong at or after the new
    // entry: this undoes the earlier switch. If the chain still doesn't fit (a step before
    // them was switched off by hand), `issues` says so.
    for (const s of steps) {
      if (s.enabled !== false || !s.offForEntry || !registry.get(s.step) || rankOf(s) < RANK[stage]) continue;
      s.enabled = true;
      delete s.offForEntry;
      switchedOn.push(title(s));
    }
  }
  return { recipe: { ...recipe, input: stage, steps }, changed: true, switchedOff, switchedOn, issues: checkChain(stage, steps, registry) };
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** What to tell the person after `enterAt`, or null when nothing changed and everything fits. */
export function describeEntry(source: string, stage: StageKind, res: EntryResult): string | null {
  if (!res.changed && !res.issues.length) return null;
  const parts = [`${source} enters as ${STAGE_WORDS[stage]}, so the chain now starts there.`];
  const n = res.switchedOff.length;
  if (n) parts.push(`Switched off ${list(res.switchedOff)}: ${n === 1 ? "it works" : "they work"} before that stage, and ${n === 1 ? "stays" : "stay"} in the recipe for when you open an image again.`);
  if (res.switchedOn.length) parts.push(`Switched ${list(res.switchedOn)} back on.`);
  if (res.issues.length) parts.push(`The recipe doesn't fit yet: ${res.issues[0]!.reason}`);
  return parts.join(" ");
}
