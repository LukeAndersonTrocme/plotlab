import type { Recipe } from "./recipe.ts";
import type { StepContext, StepRegistry } from "./step.ts";
import type { StageData } from "./types.ts";

export interface StepResult {
  index: number;
  step: string;
  output: StageData;
  ms: number;
  cached: boolean;
}

/**
 * Runs recipes and caches each step's output keyed on (upstream key, step, version, params),
 * so changing step N only recomputes steps N..end.
 *
 * A Pipeline is tied to one source; make a new one (or call `reset`) for a new source.
 */
export class Pipeline {
  private cache = new Map<number, { key: string; output: StageData }>();

  constructor(private registry: StepRegistry) {}

  reset(): void {
    this.cache.clear();
  }

  async run(
    source: StageData,
    recipe: Recipe,
    opts: { sourceKey?: string; onStep?: (r: StepResult) => void } = {},
  ): Promise<{ output: StageData; results: StepResult[] }> {
    const ctx: StepContext = {
      paper: recipe.paper,
      pens: recipe.pens,
      machine: recipe.machine,
    };
    const project = JSON.stringify([recipe.paper, recipe.pens, recipe.machine]);
    let key = `${opts.sourceKey ?? "source"}|${project}`;
    let data = source;
    const results: StepResult[] = [];
    for (const [index, rs] of recipe.steps.entries()) {
      if (rs.enabled === false) continue;
      const def = this.registry.get(rs.step);
      if (!def) throw new Error(`unknown step "${rs.step}"`);
      if (def.input !== data.kind) throw new Error(`${def.id} expects ${def.input} but receives ${data.kind}`);
      key = `${key}>${def.id}@${def.version}${JSON.stringify(rs.params)}`;
      const hit = this.cache.get(index);
      const t0 = performance.now();
      let cached = false;
      if (hit && hit.key === key) {
        data = hit.output;
        cached = true;
      } else {
        // Params were validated by loadRecipe; the registry erases their static type.
        data = await def.run(data, rs.params as never, ctx);
        this.cache.set(index, { key, output: data });
      }
      const r: StepResult = { index, step: def.id, output: data, ms: performance.now() - t0, cached };
      results.push(r);
      opts.onStep?.(r);
    }
    // Drop cache entries past the end of a shortened recipe.
    for (const k of this.cache.keys()) if (k >= recipe.steps.length) this.cache.delete(k);
    return { output: data, results };
  }
}
