/// <reference lib="webworker" />
import { exportOutput, exportProof, imageToRGBA, inkFor, layerToRGBA, leftoverRasters, Pipeline, StepError, toPlot, zipFiles, type Image, type Layers, type Plot, type Recipe, type Source, type StageData, type StepResult } from "@plotlab/engine";
import { estimatePlot, getMachine } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import type { FromWorker, InspectTarget, InspectView, RasterView, ToWorker } from "./protocol.ts";
import { shownAt } from "./strip.ts";
import { ThumbnailRenderer } from "./thumbs.ts";

/** Longest side of the low-res proxy used while dragging. */
const PROXY_SIDE = 400;
/**
 * Once a newer request is waiting, thumbnails get at most this long before the worker moves
 * on to it: the canvas comes first, and the strip catches up when the slider rests.
 */
const THUMB_BUDGET_MS = 25;

const registry = createRegistry();
const full = new Pipeline(registry);
const proxy = new Pipeline(registry);
let src: { source: Source; key: string } | null = null;
/** Encoded PNGs keyed by the pixel buffer they came from (outputs are cached by the pipeline, so identity is stable). */
let pngCache = new WeakMap<object, Map<string, Promise<Blob>>>();
const thumbnails = new ThumbnailRenderer();

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

/** Rasters the result view shows besides lines: wherever each layer's chain stopped. */
async function resultRasters(output: StageData, recipe: Recipe): Promise<RasterView[]> {
  const { image, layers } = leftoverRasters(output);
  return [...(image ? [await imageView(image, "image", "Image")] : []), ...(await layerViews(layers ?? undefined, recipe))];
}

/** The page as it will export, as one raster over the whole paper. Smaller while dragging. */
async function proofView(output: StageData, plot: Plot | null, recipe: Recipe, proxy: boolean): Promise<RasterView> {
  const p = exportProof(output, plot, recipe, proxy ? 900 : 2400);
  const c = new OffscreenCanvas(p.width, p.height);
  c.getContext("2d")!.putImageData(new ImageData(p.rgba, p.width, p.height), 0, 0);
  const frame = { xMm: 0, yMm: 0, widthMm: recipe.paper.widthMm, heightMm: recipe.paper.heightMm };
  return { id: "proof", name: "As exported", color: null, mix: "normal", frame, png: await c.convertToBlob({ type: "image/png" }) };
}

// One message at a time: an export must not interleave with a run on the same pipeline cache.
let queue: Promise<void> = Promise.resolve();
/** Messages received so far; a handler numbered below this has a newer request waiting. */
let arrived = 0;
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const n = ++arrived;
  queue = queue.then(() => handle(e.data, n));
};

/**
 * One thumbnail per strip box: the source, then each step's output (what passes through
 * for a switched-off step; traced order for an on-demand step that hasn't run).
 */
async function postThumbs(msg: Extract<ToWorker, { type: "run" }>, side: number, placed: StageData, results: StepResult[], n: number): Promise<void> {
  const ran = results.map((r) => r.index);
  const boxes = [
    { key: "source", data: placed },
    ...msg.recipe.steps.map((s, i) => {
      const at = shownAt(i, ran);
      return { key: s.id, data: at < 0 ? placed : results.find((r) => r.index === at)!.output };
    }),
  ];
  const items: Array<{ key: string; png: Blob }> = [];
  const t0 = performance.now();
  for (const b of boxes) {
    const fresh = !thumbnails.has(b.data, msg.recipe, side);
    if (fresh && arrived > n && performance.now() - t0 > THUMB_BUDGET_MS) break;
    items.push({ key: b.key, png: await thumbnails.png(b.data, msg.recipe, side) });
  }
  post({ type: "thumbs", id: msg.id, side, keys: boxes.map((b) => b.key), items });
}

async function handle(msg: ToWorker, n: number): Promise<void> {
  if (msg.type === "source") {
    src = { source: msg.source, key: msg.key };
    full.reset();
    proxy.reset();
    pngCache = new WeakMap();
    thumbnails.reset();
    return;
  }
  if (!src) return;
  if (msg.type === "export") {
    try {
      const { output, plot } = await full.run(src.source, msg.recipe, { sourceKey: src.key, runOnDemand: true });
      const { files, notes } = exportOutput(output, plot, msg.recipe, msg.format, msg.stem);
      const one = files.length === 1 ? files[0]! : { name: `${msg.stem}-plates.zip`, type: "application/zip", data: zipFiles(files) };
      post({ type: "exported", id: msg.id, name: one.name, mime: one.type, data: one.data, notes });
    } catch (err) {
      post({ type: "export-error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  try {
    const p = msg.proxy ? proxy : full;
    const { output, plot, results, warnings, placed, stale } = await p.run(src.source, msg.recipe, {
      sourceKey: src.key,
      maxSidePx: msg.proxy ? PROXY_SIDE : undefined,
      runOnDemand: msg.runOnDemand && !msg.proxy,
    });
    const estimate = plot && msg.recipe.target.kind === "plotter" ? estimatePlot(plot, getMachine(msg.recipe.machine)) : null;
    const target: InspectTarget = msg.inspect;
    let inspected: InspectView | null = null;
    if (target === "source") inspected = await view(placed, -1, msg.recipe);
    else if (typeof target === "number") {
      // A switched-off step shows what passes through it; an on-demand step that hasn't run, traced order.
      const at = shownAt(target, results.map((r) => r.index));
      const r = results.find((x) => x.index === at);
      inspected = await view(r ? r.output : placed, target, msg.recipe);
    }
    post({
      type: "result",
      id: msg.id,
      proxy: msg.proxy,
      plot,
      estimate,
      warnings,
      working: placed.kind === "geometry" ? null : { width: placed.width, height: placed.height, mmPerPx: placed.frame.widthMm / placed.width },
      stale,
      steps: results.map((r) => ({ index: r.index, id: msg.recipe.steps[r.index]!.id, step: r.step, ms: r.ms, cached: r.cached, layers: r.layers })),
      rasterLayers: await resultRasters(output, msg.recipe),
      inspected,
      underlay: placed.kind === "image" ? await imageView(placed, "source", "Source") : null,
      proof: msg.proof ? await proofView(output, plot, msg.recipe, msg.proxy) : null,
    });
    // A thumbnail that fails to draw leaves the strip as it was; the run itself went fine.
    if (msg.thumbs) await postThumbs(msg, msg.thumbs, placed, results, n).catch(() => undefined);
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      index: err instanceof StepError ? err.index : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
