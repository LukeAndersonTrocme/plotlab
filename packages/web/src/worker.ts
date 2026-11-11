/// <reference lib="webworker" />
import { downscale, Pipeline, type Image, type Plot } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import type { FromWorker, ToWorker } from "./protocol.ts";

/** Longest side of the low-res proxy used while dragging. */
const PROXY_SIDE = 400;

const registry = createRegistry();
const full = new Pipeline(registry);
const proxy = new Pipeline(registry);
let src: { full: Image; proxy: Image; key: string } | null = null;

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "source") {
    src = { full: msg.image, proxy: downscale(msg.image, PROXY_SIDE), key: msg.key };
    full.reset();
    proxy.reset();
    return;
  }
  if (!src) return;
  try {
    const p = msg.proxy ? proxy : full;
    const { output, results } = await p.run(msg.proxy ? src.proxy : src.full, msg.recipe, {
      sourceKey: `${src.key}${msg.proxy ? ":proxy" : ""}`,
    });
    if (output.kind !== "plot") throw new Error(`recipe ends at ${output.kind}, not a plot`);
    post({
      type: "result",
      id: msg.id,
      proxy: msg.proxy,
      plot: output as Plot,
      timings: results.map((r) => ({ step: r.step, ms: r.ms, cached: r.cached })),
    });
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
