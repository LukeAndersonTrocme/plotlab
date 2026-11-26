import { STAGE_WORDS } from "./chain.ts";
import { applyStep, describeLayers, type LayerInfo } from "./layers.ts";
import { lanesOf, printScreenAngle } from "./lanes.ts";
import { MAX_WORKING_SIDE, placeOnPaper, resample, workingSize } from "./layout.ts";
import { inkFor, toPlot, withoutBudget, workingMmPerPx } from "./project.ts";
import type { Recipe } from "./recipe.ts";
import type { StepContext, StepRegistry } from "./step.ts";
import { sourceStage, type Geometry, type GeoFeature, type Image, type Layer, type Layers, type Plot, type Position, type RawGeometry, type RawImage, type Source, type StageData } from "./types.ts";

/** A source as placed on the paper: what step 1 receives. */
export type Placed = Image | Layers | Geometry;
/** The placed form of a source type (a RawImage places as an Image, and so on). */
export type PlacedOf<S extends Source> = S extends { kind: "layers" } ? Layers : S extends { kind: "geometry" } ? Geometry : Image;

export interface StepResult {
  index: number;
  step: string;
  output: StageData;
  ms: number;
  cached: boolean;
  /** The layers in this step's output (for selectors and ink assignment). */
  layers: LayerInfo[];
}

export interface RunOptions {
  sourceKey?: string;
  /** Proxy runs: cap the working raster's long side (e.g. 400 while dragging). */
  maxSidePx?: number;
  onStep?: (r: StepResult) => void;
  /**
   * false = stop before an on-demand step whose cached output is stale (the app shows a
   * Run button instead). Default true: the CLI and tests run everything.
   */
  runOnDemand?: boolean;
}

export interface RunOutput<P extends Placed = Placed> {
  output: StageData;
  results: StepResult[];
  /** The source as placed on paper (rasters at working resolution): what step 1 receives. */
  placed: P;
  /** The plot to preview/export: the output if it is a plot, traced-order lines if it ends at lines, else null. */
  plot: Plot | null;
  /** Project-level warnings (e.g. working resolution capped). */
  warnings: string[];
  /** Indices of on-demand steps held back because they need re-running (empty or one entry). */
  stale: number[];
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
  private placed: { key: string; data: Placed } | null = null;

  constructor(private registry: StepRegistry) {}

  reset(): void {
    this.cache.clear();
    this.placed = null;
  }

  private place(source: Source, recipe: Recipe, opts: RunOptions): { data: Placed; key: string; warnings: string[] } {
    if (sourceStage(source) === "geometry") return this.placeGeometry(source as RawGeometry, recipe, opts);
    const src = source as Exclude<Source, RawGeometry>;
    const { frame, crop } = placeOnPaper(src, recipe.paper, recipe.layout);
    const mmpp = workingMmPerPx(recipe);
    const full = workingSize(frame, crop, mmpp);
    let size = full;
    if (opts.maxSidePx) {
      const proxy = workingSize(frame, crop, mmpp, Math.min(opts.maxSidePx, MAX_WORKING_SIDE));
      if (proxy.width < size.width) size = proxy;
    }
    const key = JSON.stringify([opts.sourceKey ?? "source", frame, crop, size.width, size.height]);
    if (this.placed?.key !== key) {
      const { width, height } = size;
      let data: Placed;
      if ("kind" in src && src.kind === "layers") {
        const layers = src.layers.map((l): Layer => {
          if (l.values.kind === "tone") return { ...l, values: { kind: "tone", data: resample({ width: src.width, height: src.height, channels: 1, data: l.values.data }, crop, width, height) } };
          // Labels can't be averaged: take the nearest source pixel.
          const out = new Uint16Array(width * height);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const sx = Math.min(src.width - 1, Math.floor(crop.x + ((x + 0.5) * crop.w) / width));
              const sy = Math.min(src.height - 1, Math.floor(crop.y + ((y + 0.5) * crop.h) / height));
              out[y * width + x] = l.values.data[sy * src.width + sx]!;
            }
          return { ...l, values: { ...l.values, data: out } };
        });
        data = { kind: "layers", width, height, frame, layers };
      } else {
        const img = src as RawImage;
        data = { kind: "image", width, height, channels: img.channels, data: resample(img, crop, width, height), frame };
      }
      this.placed = { key, data };
    }
    return { data: this.placed.data, key, warnings: full.warnings };
  }

  /** Lines are scaled into the frame like an image would be (ADR 0005); there is no working resolution. */
  private placeGeometry(src: RawGeometry, recipe: Recipe, opts: RunOptions): { data: Placed; key: string; warnings: string[] } {
    const { frame, crop } = placeOnPaper({ width: src.widthMm, height: src.heightMm }, recipe.paper, recipe.layout);
    const key = JSON.stringify([opts.sourceKey ?? "source", "geometry", frame, crop]);
    const warnings = crop.w < src.widthMm - 1e-9 || crop.h < src.heightMm - 1e-9 ? ["Fill crops images, but lines outside the frame aren't cut off yet: use Fit for SVG sources."] : [];
    if (this.placed?.key !== key) {
      const s = frame.widthMm / crop.w;
      const at = (p: Position): Position => [frame.xMm + (p[0] - crop.x) * s, frame.yMm + (p[1] - crop.y) * s];
      const move = (f: GeoFeature): GeoFeature =>
        f.geometry.type === "LineString"
          ? { ...f, geometry: { type: "LineString", coordinates: f.geometry.coordinates.map(at) } }
          : { ...f, geometry: { type: "Polygon", coordinates: f.geometry.coordinates.map((r) => r.map(at)) } };
      const layers = src.layers.map((l) => ({ ...l, features: { type: "FeatureCollection" as const, features: l.features.features.map(move) } }));
      this.placed = { key, data: { kind: "geometry", paper: recipe.paper, layers } };
    }
    return { data: this.placed.data, key, warnings };
  }

  async run<S extends Source>(source: S, recipe: Recipe, opts: RunOptions = {}): Promise<RunOutput<PlacedOf<S>>> {
    const stage = sourceStage(source);
    if (recipe.input !== stage) {
      throw new Error(`This source enters as ${STAGE_WORDS[stage]}, but the recipe starts at ${STAGE_WORDS[recipe.input]}. Set the recipe's "input" to "${stage}".`);
    }
    // Print screen angles only mean something once the picture is split into inks.
    const angles = recipe.screenAngles === true && lanesOf(recipe, this.registry).split !== null;
    const ctx: StepContext = {
      paper: recipe.paper,
      target: recipe.target,
      inks: recipe.inks,
      inkFor: (id) => inkFor(recipe, id),
      passOrder: recipe.passOrder,
      screenAngle: (id, i) => (angles ? printScreenAngle(id, i) : 0),
    };
    const placed = this.place(source, recipe, opts);
    const inkKey = JSON.stringify([recipe.inks, recipe.layerInks, recipe.passOrder]);
    let key = `${placed.key}|${JSON.stringify(withoutBudget(recipe.target))}`;
    let data: StageData = placed.data;
    const results: StepResult[] = [];
    const stale: number[] = [];
    for (const [index, rs] of recipe.steps.entries()) {
      if (rs.enabled === false) continue;
      const def = this.registry.get(rs.step);
      if (!def) throw new StepError(index, `unknown step "${rs.step}"`);
      if (def.input !== data.kind) throw new StepError(index, `${def.title} needs ${def.input} but receives ${data.kind}`);
      key = `${key}>${def.id}@${def.version}${JSON.stringify([rs.params, rs.layers, rs.layerParams])}`;
      if (def.output === "plot") key += inkKey;
      if (def.usesScreenAngles && angles) key += "|screen-angles";
      const hit = this.cache.get(index);
      if (opts.runOnDemand === false && def.cost === "on-demand" && hit?.key !== key) {
        stale.push(index);
        break;
      }
      const t0 = performance.now();
      let cached = false;
      if (hit && hit.key === key) {
        data = hit.output;
        cached = true;
      } else {
        try {
          // Params were validated by loadRecipe; the registry erases their static type.
          data = await applyStep(def, data, rs, ctx);
        } catch (e) {
          if (e instanceof StepError) throw e;
          throw new StepError(index, e instanceof Error ? e.message : String(e));
        }
        this.cache.set(index, { key, output: data });
      }
      const r: StepResult = { index, step: def.id, output: data, ms: performance.now() - t0, cached, layers: describeLayers(data) };
      results.push(r);
      opts.onStep?.(r);
    }
    // Drop cache entries past the end of a shortened recipe.
    for (const k of this.cache.keys()) if (k >= recipe.steps.length) this.cache.delete(k);
    const plot = data.kind === "plot" ? data : data.kind === "geometry" ? toPlot(data, ctx) : null;
    return { output: data, results, placed: placed.data as PlacedOf<S>, plot, warnings: placed.warnings, stale };
  }
}
