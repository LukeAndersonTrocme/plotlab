import type { Plot, RawImage, Recipe } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import type { FromWorker, InspectTarget, InspectView, RasterView, StepInfo, ToWorker } from "./protocol.ts";

export interface RunState {
  plot: Plot | null;
  estimate: PlotEstimate | null;
  warnings: string[];
  steps: StepInfo[];
  rasterLayers: RasterView[];
  inspected: InspectView | null;
  underlay: RasterView | null;
  /** True while the preview shows a low-res proxy result (full resolution comes on release). */
  refining: boolean;
  busy: boolean;
  error: { message: string; index?: number } | null;
}

export const EMPTY_RUN: RunState = {
  plot: null,
  estimate: null,
  warnings: [],
  steps: [],
  rasterLayers: [],
  inspected: null,
  underlay: null,
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
  private pending: { recipe: Recipe; proxy: boolean } | null = null;
  /** Which stage the view shows; sent with every run. */
  inspect: InspectTarget = null;
  state: RunState = EMPTY_RUN;

  constructor(private onChange: (s: RunState) => void) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  setSource(image: RawImage, key: string): void {
    const msg: ToWorker = { type: "source", image, key };
    this.worker.postMessage(msg);
  }

  /** proxy = true while dragging; false on release / for on-demand updates. */
  request(recipe: Recipe, proxy: boolean): void {
    this.pending = { recipe, proxy };
    this.pump();
  }

  private pump(): void {
    if (this.inFlight !== null || !this.pending) return;
    const { recipe, proxy } = this.pending;
    this.pending = null;
    const id = this.nextId++;
    this.inFlight = id;
    const msg: ToWorker = { type: "run", id, recipe, proxy, inspect: this.inspect };
    this.worker.postMessage(msg);
    this.set({ busy: true });
  }

  private receive(m: FromWorker): void {
    this.inFlight = null;
    if (m.type === "error") this.set({ error: { message: m.message, index: m.index }, busy: false });
    else {
      const { type: _t, id: _id, proxy, ...rest } = m;
      this.set({ ...rest, error: null, busy: false, refining: proxy });
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
