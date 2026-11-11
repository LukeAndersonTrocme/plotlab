/// <reference lib="webworker" />
import { imageToRGBA, inkFor, layerToRGBA, Pipeline, StepError, toPlot, type Image, type Layers, type RawImage, type Recipe, type StageData } from "@plotlab/engine";
import { estimatePlot, getMachine } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import type { FromWorker, InspectTarget, InspectView, RasterView, ToWorker } from "./protocol.ts";

/** Longest side of the low-res proxy used while dragging. */
const PROXY_SIDE = 400;

const registry = createRegistry();
const full = new Pipeline(registry);
const proxy = new Pipeline(registry);
let src: { image: RawImage; key: string } | null = null;
/** Encoded PNGs keyed by the pixel buffer they came from (outputs are cached by the pipeline, so identity is stable). */
let pngCache = new WeakMap<object, Map<string, Promise<Blob>>>();

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function png(key: object, tint: string, width: number, height: number, rgba: () => Uint8ClampedArray): Promise<Blob> {
  let m = pngCache.get(key);
  if (!m) pngCache.set(key, (m = new Map()));
  let p = m.get(tint);
  if (!p) {
    const c = new OffscreenCanvas(width, height);
    c.getContext("2d")!.putImageData(new ImageData(rgba(), width, height), 0, 0);
    p = c.convertToBlob({ type: "image/png" });
    m.set(tint, p);
  }
  return p;
}

async function imageView(img: Image, id: string, name: string): Promise<RasterView> {
  return { id, name, color: null, mix: "normal", frame: img.frame, png: await png(img.data, "", img.width, img.height, () => imageToRGBA(img)) };
}

async function layerViews(ls: Layers | undefined, recipe: Recipe): Promise<RasterView[]> {
  if (!ls) return [];
  return Promise.all(
    ls.layers.map(async (l) => {
      const ink = inkFor(recipe, l.id);
      const blob = await png(l.values.data, ink.color, ls.width, ls.height, () => layerToRGBA(l, ls.width, ls.height, ink.color));
      return { id: l.id, name: l.name, color: ink.color, mix: ink.mix, frame: ls.frame, png: blob };
    }),
  );
}

async function view(data: StageData, index: number, recipe: Recipe): Promise<InspectView> {
  const settings = { paper: recipe.paper, inkFor: (id: string) => inkFor(recipe, id), passOrder: recipe.passOrder };
  switch (data.kind) {
    case "image":
      return { kind: index < 0 ? "source" : "image", index, rasters: [await imageView(data, "image", "Image")], plot: null };
    case "layers":
      return { kind: "layers", index, rasters: await layerViews(data, recipe), plot: null };
    case "geometry":
      return { kind: "geometry", index, rasters: await layerViews(data.rasterLayers, recipe), plot: toPlot(data, settings) };
    case "plot":
      return { kind: "plot", index, rasters: await layerViews(data.rasterLayers, recipe), plot: data };
  }
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "source") {
    src = { image: msg.image, key: msg.key };
    full.reset();
    proxy.reset();
    pngCache = new WeakMap();
    return;
  }
  if (!src) return;
  try {
    const p = msg.proxy ? proxy : full;
    const { plot, results, warnings, placed, stale } = await p.run(src.image, msg.recipe, {
      sourceKey: src.key,
      maxSidePx: msg.proxy ? PROXY_SIDE : undefined,
      runOnDemand: msg.runOnDemand && !msg.proxy,
    });
    const estimate = plot && msg.recipe.target.kind === "plotter" ? estimatePlot(plot, getMachine(msg.recipe.machine)) : null;
    const target: InspectTarget = msg.inspect;
    let inspected: InspectView | null = null;
    if (target === "source") inspected = await view(placed, -1, msg.recipe);
    else if (typeof target === "number") {
      const r = results.find((x) => x.index === target);
      if (r) inspected = await view(r.output, r.index, msg.recipe);
    }
    post({
      type: "result",
      id: msg.id,
      proxy: msg.proxy,
      plot,
      estimate,
      warnings,
      working: { width: placed.width, height: placed.height, mmPerPx: placed.frame.widthMm / placed.width },
      stale,
      steps: results.map((r) => ({ index: r.index, step: r.step, ms: r.ms, cached: r.cached, layers: r.layers })),
      rasterLayers: await layerViews(plot?.rasterLayers, msg.recipe),
      inspected,
      underlay: await imageView(placed, "source", "Source"),
    });
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      index: err instanceof StepError ? err.index : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
