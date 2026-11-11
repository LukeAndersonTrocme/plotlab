import { MAX_WORKING_SIDE, placeOnPaper, resample, workingSize } from "./layout.ts";
import { inkFor, toPlot, workingMmPerPx } from "./project.ts";
import type { Recipe } from "./recipe.ts";
import type { StepContext, StepRegistry } from "./step.ts";
import type { Image, Plot, RawImage, StageData } from "./types.ts";

export interface StepResult {
  index: number;
  step: string;
  output: StageData;
  ms: number;
  cached: boolean;
}

export interface RunOptions {
  sourceKey?: string;
  /** Proxy runs: cap the working raster's long side (e.g. 400 while dragging). */
  maxSidePx?: number;
  onStep?: (r: StepResult) => void;
}

export interface RunOutput {
  output: StageData;
  results: StepResult[];
  /** The source as placed on paper at working resolution: what step 1 receives. */
  placed: Image;
  /** The plot to preview/export: the output if it is a plot, traced-order lines if it ends at lines, else null. */
  plot: Plot | null;
  /** Project-level warnings (e.g. working resolution capped). */
  warnings: string[];
}

export class StepError extends Error {
  constructor(
    public readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Runs recipes. The source is first placed on paper at the working resolution, then each
 * step's output is cached keyed on (upstream key, step, version, params), so changing
 * step N only recomputes steps N..end.
 *
 * A Pipeline is tied to one source; make a new one (or call `reset`) for a new source.
 */
export class Pipeline {
  private cache = new Map<number, { key: string; output: StageData }>();
  private placed: { key: string; image: Image } | null = null;

  constructor(private registry: StepRegistry) {}

  reset(): void {
    this.cache.clear();
    this.placed = null;
  }

  private place(source: RawImage, recipe: Recipe, opts: RunOptions): { image: Image; key: string; warnings: string[] } {
    const { frame, crop } = placeOnPaper(source, recipe.paper, recipe.layout);
    const mmpp = workingMmPerPx(recipe);
    const full = workingSize(frame, crop, mmpp);
    let size = full;
    if (opts.maxSidePx) {
      const proxy = workingSize(frame, crop, mmpp, Math.min(opts.maxSidePx, MAX_WORKING_SIDE));
      if (proxy.width < size.width) size = proxy;
    }
    const key = JSON.stringify([opts.sourceKey ?? "source", frame, crop, size.width, size.height]);
    if (this.placed?.key !== key) {
      const data = resample(source, crop, size.width, size.height);
      this.placed = { key, image: { kind: "image", width: size.width, height: size.height, channels: source.channels, data, frame } };
    }
    return { image: this.placed.image, key, warnings: full.warnings };
  }

  async run(source: RawImage, recipe: Recipe, opts: RunOptions = {}): Promise<RunOutput> {
    if (recipe.input !== "image") throw new Error(`sources entering at "${recipe.input}" aren't supported yet`);
    const ctx: StepContext = {
      paper: recipe.paper,
      target: recipe.target,
      inks: recipe.inks,
      inkFor: (id) => inkFor(recipe, id),
      passOrder: recipe.passOrder,
    };
    const placed = this.place(source, recipe, opts);
    const inkKey = JSON.stringify([recipe.inks, recipe.layerInks, recipe.passOrder]);
    let key = `${placed.key}|${JSON.stringify(recipe.target)}`;
    let data: StageData = placed.image;
    const results: StepResult[] = [];
    for (const [index, rs] of recipe.steps.entries()) {
      if (rs.enabled === false) continue;
      const def = this.registry.get(rs.step);
      if (!def) throw new StepError(index, `unknown step "${rs.step}"`);
      if (def.input !== data.kind) throw new StepError(index, `${def.title} needs ${def.input} but receives ${data.kind}`);
      key = `${key}>${def.id}@${def.version}${JSON.stringify([rs.params, rs.layers, rs.layerParams])}`;
      if (def.output === "plot") key += inkKey;
      const hit = this.cache.get(index);
      const t0 = performance.now();
      let cached = false;
      if (hit && hit.key === key) {
        data = hit.output;
        cached = true;
      } else {
        try {
          // Params were validated by loadRecipe; the registry erases their static type.
          data = await def.run(data, rs.params as never, ctx);
        } catch (e) {
          if (e instanceof StepError) throw e;
          throw new StepError(index, e instanceof Error ? e.message : String(e));
        }
        this.cache.set(index, { key, output: data });
      }
      const r: StepResult = { index, step: def.id, output: data, ms: performance.now() - t0, cached };
      results.push(r);
      opts.onStep?.(r);
    }
    // Drop cache entries past the end of a shortened recipe.
    for (const k of this.cache.keys()) if (k >= recipe.steps.length) this.cache.delete(k);
    const plot = data.kind === "plot" ? data : data.kind === "geometry" ? toPlot(data, ctx) : null;
    return { output: data, results, placed: placed.image, plot, warnings: placed.warnings };
  }
}
