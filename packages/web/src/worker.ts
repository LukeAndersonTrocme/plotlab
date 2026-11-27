/// <reference lib="webworker" />
import { exportOutput, exportProof, imageToRGBA, inkFor, lanesOf, layerToRGBA, leftoverRasters, Pipeline, StepError, toPlot, zipFiles, type Image, type Layers, type Plot, type PlotLayer, type Recipe, type Source, type StageData, type StepResult } from "@plotlab/engine";
import { estimatePlot, getMachine } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import type { FromWorker, InspectTarget, InspectView, RasterView, ToWorker } from "./protocol.ts";
import { shownAt, STACK_KEY, stripBoxes, stripLanes } from "./strip.ts";
import { Jobs } from "./jobs.ts";
import { drawResult, laneOf } from "./pictures.ts";
import { laneKey } from "./lanes.ts";
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
/** Checkpoint and gallery pictures: their own pipeline, so the canvas cache stays as it is. */
const picturePipe = new Pipeline(registry);
/** Gallery pictures by recipe and size, for this source: reopening the gallery is instant. */
let galleryCache = new Map<string, Promise<Blob>>();
let src: { source: Source; key: string } | null = null;
/** Encoded PNGs keyed by the pixel buffer they came from (outputs are cached by the pipeline, so identity is stable). */
let pngCache = new WeakMap<object, Map<string, Promise<Blob>>>();
const thumbnails = new ThumbnailRenderer();
/** One pass on its own, kept per layer object, so an unchanged pass reuses its picture. */
const passPlots = new WeakMap<PlotLayer, Plot>();

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
  const step = index < 0 ? "source" : recipe.steps[index]!.id;
  const settings = { paper: recipe.paper, inkFor: (id: string) => inkFor(recipe, id), passOrder: recipe.passOrder };
  switch (data.kind) {
    case "image":
      return { kind: index < 0 ? "source" : "image", index, step, rasters: [await imageView(data, "image", "Image")], plot: null };
    case "layers":
      return { kind: "layers", index, step, rasters: await layerViews(data, recipe), plot: null };
    case "geometry":
      return { kind: "geometry", index, step, rasters: await layerViews(data.rasterLayers, recipe), plot: toPlot(data, settings) };
    case "plot":
      return { kind: "plot", index, step, rasters: await layerViews(data.rasterLayers, recipe), plot: data };
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
// Pictures (checkpoint, gallery) wait in the background, one at a time, behind any run (pictures.ts).
const jobs = new Jobs();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  const lane = laneOf(msg);
  if (lane.lane === "foreground") {
    if (msg.type !== "thumbnail" && msg.type !== "gallery") jobs.foreground(() => handle(msg));
    return;
  }
  // The source is the one current when asked: a picture asked for before an image switch is of the old image.
  const at = src;
  if (msg.type === "gallery") jobs.background(lane.group, msg.items.map((item) => () => galleryThumb(at, msg.id, msg.side, item)));
  else if (msg.type === "thumbnail") jobs.background(lane.group, [() => checkpointThumb(at, msg)]);
};

/** A checkpoint's picture: its end result, without running on-demand steps (never a full-resolution run). */
async function checkpointThumb(at: typeof src, msg: Extract<ToWorker, { type: "thumbnail" }>): Promise<void> {
  const png = at
    ? await drawResult(picturePipe, at, msg.recipe, msg.side)
        .then((r) => thumbnails.png(r.output, msg.recipe, msg.side))
        .catch(() => null)
    : null;
  post({ type: "thumbnail", id: msg.id, png });
}

/** One preset drawn on the source, at about thumbnail resolution. */
async function galleryThumb(at: typeof src, id: number, side: number, item: { key: string; recipe: Recipe }): Promise<void> {
  if (!at) return;
  const k = JSON.stringify([side, item.recipe]);
  let p = galleryCache.get(k);
  if (!p) {
    p = drawResult(picturePipe, at, item.recipe, side).then((r) => thumbnails.png(r.output, item.recipe, side));
    galleryCache.set(k, p);
    p.catch(() => galleryCache.delete(k));
  }
  post({ type: "gallery-thumb", id, key: item.key, png: await p.catch(() => null) });
}

/** One pass's picture for Plot mode's strip: that pen's lines alone. */
async function passThumb(id: number, side: number, recipe: Recipe, plot: Plot, layer: PlotLayer): Promise<void> {
  let one = passPlots.get(layer);
  if (!one) passPlots.set(layer, (one = { kind: "plot", paper: plot.paper, layers: [layer], ordered: plot.ordered }));
  const png = await thumbnails.png(one, recipe, side).catch(() => null);
  post({ type: "pass-thumb", id, keys: plot.layers.map((l) => l.id), key: layer.id, png });
}

/**
 * One thumbnail per strip box: the source, then each step's output (what passes through
 * for a switched-off step; traced order for an on-demand step that hasn't run). In a split
 * chain the split and the lane steps show each ink as a 2×2 (linked), or each lane's steps
 * show their ink alone (independent); the Stack box shows all the inks together after the
 * last lane step.
 */
async function postThumbs(msg: Extract<ToWorker, { type: "run" }>, side: number, placed: StageData, results: StepResult[]): Promise<void> {
  const ran = results.map((r) => r.index);
  const outputAt = (i: number) => {
    const at = shownAt(i, ran);
    return at < 0 ? placed : results.find((r) => r.index === at)!.output;
  };
  const lanes = stripLanes(msg.recipe, registry);
  const laneBox = new Map(stripBoxes(msg.recipe, registry, { steps: [], stale: [] }).map((b) => [b.key, b.lane]));
  const own = lanes && !lanes.linked;
  const steps = msg.recipe.steps.flatMap((s, i) => {
    const lane = laneBox.get(s.id);
    if (!lanes || !lane || lane === "split") return [{ key: s.id, data: outputAt(i), lanes: lane ? lanes?.layers : undefined }];
    return own ? [] : [{ key: s.id, data: outputAt(i), lanes: lanes.layers as string[] | string | undefined }];
  });
  const laneSteps = own ? lanesOf(msg.recipe, registry).lanes.flatMap((l) => l.steps.map((s) => ({ key: laneKey(s.id, l.layer), data: outputAt(s.index), lanes: l.layer as string[] | string | undefined }))) : [];
  const boxes = [
    { key: "source", data: placed, lanes: undefined as string[] | string | undefined },
    ...steps,
    ...laneSteps,
    ...(lanes ? [{ key: STACK_KEY, data: outputAt(lanes.stackAfter), lanes: undefined }] : []),
  ];
  const items: Array<{ key: string; png: Blob }> = [];
  const t0 = performance.now();
  for (const b of boxes) {
    const fresh = !thumbnails.has(b.data, msg.recipe, side, b.lanes);
    if (fresh && jobs.waiting() && performance.now() - t0 > THUMB_BUDGET_MS) break;
    items.push({ key: b.key, png: await thumbnails.png(b.data, msg.recipe, side, b.lanes) });
  }
  post({ type: "thumbs", id: msg.id, side, keys: boxes.map((b) => b.key), items });
}

async function handle(msg: Exclude<ToWorker, { type: "gallery" | "thumbnail" }>): Promise<void> {
  if (msg.type === "source") {
    src = { source: msg.source, key: msg.key };
    full.reset();
    proxy.reset();
    picturePipe.reset();
    galleryCache = new Map();
    jobs.background("gallery", []);
    jobs.background("passes", []);
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
    const ran = results.map((r) => r.index);
    const inspectAt = async (target: InspectTarget): Promise<InspectView | null> => {
      if (target === "source") return view(placed, -1, msg.recipe);
      if (typeof target !== "number" || target < 0 || target >= msg.recipe.steps.length) return null;
      // A switched-off step shows what passes through it; an on-demand step that hasn't run, traced order.
      const r = results.find((x) => x.index === shownAt(target, ran));
      return view(r ? r.output : placed, target, msg.recipe);
    };
    const inspected = await inspectAt(msg.inspect);
    // Compare stages: every strip from this one run (stage outputs are already in hand, and
    // their PNGs are cached by pixel buffer), so the strips keep pace with the canvas.
    const compared = msg.compare ? await Promise.all(msg.compare.map(inspectAt)) : null;
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
      compared,
      underlay: placed.kind === "image" ? await imageView(placed, "source", "Source") : null,
      proof: msg.proof ? await proofView(output, plot, msg.recipe, msg.proxy) : null,
    });
    // A thumbnail that fails to draw leaves the strip as it was; the run itself went fine.
    if (msg.thumbs) await postThumbs(msg, msg.thumbs, placed, results).catch(() => undefined);
    // Pass pictures wait in the background, one pass per task, so a run sent meanwhile goes
    // first; a newer run's pictures replace what's left of these.
    if (msg.passes && plot && !msg.proxy) {
      const side = msg.passes;
      jobs.background("passes", plot.layers.map((l) => () => passThumb(msg.id, side, msg.recipe, plot, l)));
    }
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      index: err instanceof StepError ? err.index : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
