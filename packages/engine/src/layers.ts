import type { RecipeStep } from "./recipe.ts";
import type { AnyStep, StepContext, StepWarning } from "./step.ts";
import type { GeometryLayer, Image, Layer, Layers, LayerValueKind, StageData } from "./types.ts";

/** A layer as the UI sees it in a step's output. */
export interface LayerInfo {
  id: string;
  name: string;
  kind: LayerValueKind | "lines";
}

const KIND_WORDS: Record<LayerValueKind, string> = { tone: "tone", categories: "categories" };
const SUGGEST: Record<LayerValueKind, string> = {
  tone: "Add a step that turns categories into tone before it.",
  categories: "Add Levels before it to turn tone into categories.",
};

/** Thrown when a layer-acting step meets a layer kind it can't handle. Plain language for the UI. */
export class LayerKindError extends Error {}

/**
 * Apply a layer-acting step: transform the selected layers with their per-layer params.
 * Unselected layers pass through in place (layers → layers) or ride along as
 * `rasterLayers` (layers → lines).
 */
export async function applyLayerStep(
  def: AnyStep,
  input: Layers,
  rs: Pick<RecipeStep, "params" | "layers" | "layerParams">,
  ctx: StepContext,
  warnings?: StepWarning[],
): Promise<StageData> {
  const sel = rs.layers ?? "all";
  const selected = (l: Layer) => sel === "all" || sel.includes(l.id);
  const accepts: LayerValueKind[] = def.accepts ?? ["tone", "categories"];
  for (const l of input.layers) {
    if (selected(l) && !accepts.includes(l.values.kind)) {
      const want = accepts.map((k) => KIND_WORDS[k]).join(" or ");
      const verb = def.output === "geometry" ? "traces" : "works on";
      throw new LayerKindError(
        `${def.title} ${verb} ${want} layers, but "${l.name}" holds ${KIND_WORDS[l.values.kind]}. ${SUGGEST[accepts[0]!]}`,
      );
    }
  }
  const grid = { width: input.width, height: input.height, frame: input.frame };
  // Params were validated by loadRecipe; the registry erases their static type.
  // Progress runs once from 0 to 1 across all the selected layers, not once per layer.
  const total = input.layers.filter(selected).length;
  let done = 0;
  const run = (l: Layer) => {
    const k = done++;
    const progress = ctx.progress && ((f: number) => ctx.progress!((k + f) / total));
    const warn = warnings ? collect(warnings, l.id) : ctx.warn;
    return def.runLayer!(l, { ...rs.params, ...rs.layerParams?.[l.id] } as never, { ...ctx, progress, warn }, grid);
  };
  if (def.output === "layers") {
    const layers: Layer[] = [];
    for (const l of input.layers) layers.push(selected(l) ? ((await run(l)) as Layer) : l);
    return { ...input, layers };
  }
  const lines: GeometryLayer[] = [];
  const rest: Layer[] = [];
  for (const l of input.layers) {
    if (selected(l)) lines.push((await run(l)) as GeometryLayer);
    else rest.push(l);
  }
  return {
    kind: "geometry",
    paper: ctx.paper,
    layers: lines,
    ...(rest.length ? { rasterLayers: { ...input, layers: rest } } : {}),
  };
}

/** A `warn` that appends to `into`, tagged with the layer, skipping repeats. */
function collect(into: StepWarning[], layer?: string): (message: string) => void {
  return (message) => {
    if (into.some((w) => w.message === message && w.layer === layer)) return;
    into.push(layer === undefined ? { message } : { message, layer });
  };
}

/**
 * Run any step on its input, whole-stage or per layer. Given `warnings`, the step's `warn`
 * calls are collected there (deduplicated, tagged with the layer for per-layer runs);
 * otherwise `ctx.warn` is passed through as is.
 */
export async function applyStep(
  def: AnyStep,
  input: StageData,
  rs: Pick<RecipeStep, "params" | "layers" | "layerParams">,
  ctx: StepContext,
  warnings?: StepWarning[],
): Promise<StageData> {
  if (def.runLayer) return applyLayerStep(def, input as Layers, rs, ctx, warnings);
  return def.run!(input, rs.params as never, warnings ? { ...ctx, warn: collect(warnings) } : ctx);
}

/** The layers in a stage's output, for selectors and ink assignment in the UI. */
export function describeLayers(data: StageData): LayerInfo[] {
  const raster = (ls: Layers | undefined): LayerInfo[] => (ls?.layers ?? []).map((l) => ({ id: l.id, name: l.name, kind: l.values.kind }));
  switch (data.kind) {
    case "image":
      return [];
    case "layers":
      return raster(data);
    case "geometry":
    case "plot":
      return [...data.layers.map((l): LayerInfo => ({ id: l.id, name: l.name, kind: "lines" })), ...raster(data.rasterLayers)];
  }
}

/**
 * What the result view composites besides lines (ADR 0009: a layer's chain may stop at any
 * stage): the image if the chain never left it, the layers if it ends at layers, or the
 * layers that stopped before becoming lines.
 */
export function leftoverRasters(data: StageData): { image: Image | null; layers: Layers | null } {
  switch (data.kind) {
    case "image":
      return { image: data, layers: null };
    case "layers":
      return { image: null, layers: data };
    case "geometry":
    case "plot":
      return { image: null, layers: data.rasterLayers ?? null };
  }
}
