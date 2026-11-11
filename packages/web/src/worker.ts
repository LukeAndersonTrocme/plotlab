/// <reference lib="webworker" />
import { Pipeline, StepError, type RawImage } from "@plotlab/engine";
import { estimatePlot, getMachine } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import type { FromWorker, ToWorker } from "./protocol.ts";

/** Longest side of the low-res proxy used while dragging. */
const PROXY_SIDE = 400;

const registry = createRegistry();
const full = new Pipeline(registry);
const proxy = new Pipeline(registry);
let src: { image: RawImage; key: string } | null = null;

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "source") {
    src = { image: msg.image, key: msg.key };
    full.reset();
    proxy.reset();
    return;
  }
  if (!src) return;
  try {
    const p = msg.proxy ? proxy : full;
    const { plot, results, warnings } = await p.run(src.image, msg.recipe, {
      sourceKey: src.key,
      maxSidePx: msg.proxy ? PROXY_SIDE : undefined,
    });
    const estimate = plot && msg.recipe.target.kind === "plotter" ? estimatePlot(plot, getMachine(msg.recipe.machine)) : null;
    post({
      type: "result",
      id: msg.id,
      proxy: msg.proxy,
      plot,
      estimate,
      warnings,
      timings: results.map((r) => ({ step: r.step, ms: r.ms, cached: r.cached })),
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
