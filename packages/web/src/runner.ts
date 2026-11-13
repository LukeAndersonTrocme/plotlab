import type { ExportFormat, Plot, RawImage, Recipe } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import type { FromWorker, InspectTarget, InspectView, RasterView, StepInfo, ToWorker } from "./protocol.ts";

export interface RunState {
  plot: Plot | null;
  estimate: PlotEstimate | null;
  warnings: string[];
  working: { width: number; height: number; mmPerPx: number } | null;
  steps: StepInfo[];
  stale: number[];
  rasterLayers: RasterView[];
  inspected: InspectView | null;
  underlay: RasterView | null;
  proof: RasterView | null;
  /** True while the preview shows a low-res proxy result (full resolution comes on release). */
  refining: boolean;
  busy: boolean;
  error: { message: string; index?: number } | null;
}

export const EMPTY_RUN: RunState = {
  plot: null,
  estimate: null,
  warnings: [],
  working: null,
  steps: [],
  stale: [],
  rasterLayers: [],
  inspected: null,
  underlay: null,
  proof: null,
  refining: false,
  busy: false,
  error: null,
};

/**
 * Talks to the pipeline worker. Coalesces requests: at most one run in flight, and only
 * the latest pending request is kept, so dragging a slider never builds a queue.
 */
export class Runner {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private inFlight: number | null = null;
  private pending: { recipe: Recipe; proxy: boolean; runOnDemand: boolean } | null = null;
  /** Which stage the view shows; sent with every run. */
  inspect: InspectTarget = null;
  /** Also render the page as it will export. */
  proof = false;
  private exports = new Map<number, { resolve: (f: { name: string; mime: string; data: Uint8Array | string; notes: string[] }) => void; reject: (e: Error) => void }>();
  state: RunState = EMPTY_RUN;

  constructor(private onChange: (s: RunState) => void) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  setSource(image: RawImage, key: string): void {
    const msg: ToWorker = { type: "source", image, key };
    this.worker.postMessage(msg);
  }

  /**
   * proxy = true while dragging; false on release. runOnDemand = also run on-demand steps
   * (the Run button); otherwise they keep their last output or wait.
   */
  request(recipe: Recipe, proxy: boolean, runOnDemand = false): void {
    // A pending Run press survives being superseded by a later edit.
    const keep = !proxy && (runOnDemand || (this.pending?.runOnDemand ?? false));
    this.pending = { recipe, proxy, runOnDemand: keep };
    this.pump();
  }

  private pump(): void {
    if (this.inFlight !== null || !this.pending) return;
    const { recipe, proxy, runOnDemand } = this.pending;
    this.pending = null;
    const id = this.nextId++;
    this.inFlight = id;
    const msg: ToWorker = { type: "run", id, recipe, proxy, inspect: this.inspect, runOnDemand, proof: this.proof };
    this.worker.postMessage(msg);
    this.set({ busy: true });
  }

  /** Export files for the target. Runs after any run in flight (the worker handles messages in order). */
  export(recipe: Recipe, format: ExportFormat, stem: string): Promise<{ name: string; mime: string; data: Uint8Array | string; notes: string[] }> {
    const id = this.nextId++;
    const msg: ToWorker = { type: "export", id, recipe, format, stem };
    return new Promise((resolve, reject) => {
      this.exports.set(id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  private receive(m: FromWorker): void {
    if (m.type === "exported" || m.type === "export-error") {
      const p = this.exports.get(m.id);
      this.exports.delete(m.id);
      if (m.type === "exported") p?.resolve(m);
      else p?.reject(new Error(m.message));
      return;
    }
    this.inFlight = null;
    if (m.type === "error") this.set({ error: { message: m.message, index: m.index }, busy: false });
    else {
      const { type: _t, id: _id, proxy, working, ...rest } = m;
      // The readout describes full-resolution work; proxies would make it flicker.
      this.set({ ...rest, ...(proxy ? {} : { working }), error: null, busy: false, refining: proxy });
    }
    this.pump();
  }

  private set(p: Partial<RunState>): void {
    this.state = { ...this.state, ...p };
    this.onChange(this.state);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
