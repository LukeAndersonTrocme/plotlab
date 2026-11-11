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
    if (def.input !== current) {
      issues.push({
        index,
        reason: `${def.title} needs ${STAGE_WORDS[def.input]}, but at that point the chain has ${STAGE_WORDS[current]}. ${advice(def.input, input, registry)}`,
      });
    }
    current = def.output;
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
