import type { Plot, RawImage, Recipe } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import type { FromWorker, ToWorker } from "./protocol.ts";

export interface RunState {
  plot: Plot | null;
  estimate: PlotEstimate | null;
  warnings: string[];
  /** True while the preview shows a low-res proxy result (full resolution comes on release). */
  refining: boolean;
  busy: boolean;
  error: string | null;
  timings: Array<{ step: string; ms: number; cached: boolean }>;
}

/**
 * Talks to the pipeline worker. Coalesces requests: at most one run in flight, and only
 * the latest pending request is kept, so dragging a slider never builds a queue.
 */
export class Runner {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private inFlight: number | null = null;
  private pending: { recipe: Recipe; proxy: boolean } | null = null;
  state: RunState = { plot: null, estimate: null, warnings: [], refining: false, busy: false, error: null, timings: [] };

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
    const msg: ToWorker = { type: "run", id, recipe, proxy };
    this.worker.postMessage(msg);
    this.set({ busy: true });
  }

  private receive(m: FromWorker): void {
    this.inFlight = null;
    if (m.type === "error") this.set({ error: m.message, busy: false });
    else this.set({ plot: m.plot, estimate: m.estimate, warnings: m.warnings, timings: m.timings, error: null, busy: false, refining: m.proxy });
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
