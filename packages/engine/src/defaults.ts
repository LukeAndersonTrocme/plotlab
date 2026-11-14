import type { ParamDecl } from "./params.ts";
import type { Recipe, RecipeStep } from "./recipe.ts";
import type { StepRegistry } from "./step.ts";

/**
 * "Defaults" and the Reset levels (UI round 3, 2026-11-13): one setting, one step, or the
 * whole recipe (that last one is the web app's `defaultRecipe`).
 */

/** Has this value moved away from its declared default? (Drives the "changed" dots.) */
export function isChanged(decl: ParamDecl, value: unknown): boolean {
  if (decl.type === "number" && decl.seed) return false;
  if (decl.type === "table") return JSON.stringify(value ?? {}) !== JSON.stringify(decl.default);
  return value !== decl.default;
}

const withStep = (recipe: Recipe, index: number, patch: (s: RecipeStep) => RecipeStep): Recipe => ({
  ...recipe,
  steps: recipe.steps.map((s, i) => (i === index ? patch(s) : s)),
});

/**
 * Put one setting of step `index` back to its default. With `layer`, drop that layer's
 * override instead, so the layer follows the step's setting again.
 */
export function resetParam(recipe: Recipe, index: number, name: string, registry: StepRegistry, layer?: string): Recipe {
  const decl = registry.get(recipe.steps[index]?.step ?? "")?.params[name];
  if (!decl) return recipe;
  if (layer === undefined) return withStep(recipe, index, (s) => ({ ...s, params: { ...s.params, [name]: decl.default } }));
  return withStep(recipe, index, (s) => {
    const { [name]: _, ...rest } = s.layerParams?.[layer] ?? {};
    const { [layer]: __, ...others } = s.layerParams ?? {};
    return { ...s, layerParams: Object.keys(rest).length ? { ...others, [layer]: rest } : others };
  });
}


/**
 * "Defaults for this step": every setting and layer override back to its default. Keeps the
 * seed (it picks a variation, it isn't a setting), which layers it acts on, and on/off.
 */
export function resetStep(recipe: Recipe, index: number, registry: StepRegistry): Recipe {
  const def = registry.get(recipe.steps[index]?.step ?? "");
  if (!def) return recipe;
  return withStep(recipe, index, ({ layerParams: _, ...s }) => {
    const params: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(def.params as Record<string, ParamDecl>)) {
      params[k] = d.type === "number" && d.seed && s.params[k] !== undefined ? s.params[k] : d.default;
    }
    return { ...s, params };
  });
}
