import type { ExportFormat, Plot, Recipe, Source } from "@plotlab/engine";
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
  /** Strip thumbnails by box key ("source" or step id); they may lag the canvas a little. */
  thumbs: Record<string, Blob>;
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
  thumbs: {},
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
  /** Strip thumbnail size in pixels (long side of the paper); null = no strip on screen. */
  thumbs: number | null = null;
  private exports = new Map<number, { resolve: (f: { name: string; mime: string; data: Uint8Array | string; notes: string[] }) => void; reject: (e: Error) => void }>();
  private pictures = new Map<number, (png: Blob | null) => void>();
  private gallerySeen: { id: number; onThumb: (key: string, png: Blob | null) => void } | null = null;
  state: RunState = EMPTY_RUN;

  constructor(private onChange: (s: RunState) => void) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  setSource(source: Source, key: string): void {
    const msg: ToWorker = { type: "source", source, key };
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
    const msg: ToWorker = { type: "run", id, recipe, proxy, inspect: this.inspect, runOnDemand, proof: this.proof, thumbs: this.thumbs };
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

  /**
   * The end result of `recipe` as a PNG (a checkpoint's picture), from the strip's thumbnail
   * renderer in the worker. Drawn in the background at about `side` px, behind any run, and
   * without running on-demand steps.
   */
  thumbnail(recipe: Recipe, side: number): Promise<Blob | null> {
    const id = this.nextId++;
    const msg: ToWorker = { type: "thumbnail", id, recipe, side };
    return new Promise((resolve) => {
      this.pictures.set(id, resolve);
      this.worker.postMessage(msg);
    });
  }

  /** Preset gallery pictures, drawn in the background; each arrives through `onThumb`. Replaces an earlier request. */
  gallery(items: Array<{ key: string; recipe: Recipe }>, side: number, onThumb: (key: string, png: Blob | null) => void): void {
    const id = this.nextId++;
    this.gallerySeen = { id, onThumb };
    const msg: ToWorker = { type: "gallery", id, side, items };
    this.worker.postMessage(msg);
  }

  /** Stop listening for gallery pictures (the gallery closed); the worker drops what's left. */
  closeGallery(): void {
    if (this.gallerySeen) this.gallery([], 0, () => {});
    this.gallerySeen = null;
  }

  private receive(m: FromWorker): void {
    if (m.type === "thumbnail") {
      this.pictures.get(m.id)?.(m.png);
      this.pictures.delete(m.id);
      return;
    }
    if (m.type === "gallery-thumb") {
      if (this.gallerySeen?.id === m.id) this.gallerySeen.onThumb(m.key, m.png);
      return;
    }
    if (m.type === "exported" || m.type === "export-error") {
      const p = this.exports.get(m.id);
      this.exports.delete(m.id);
      if (m.type === "exported") p?.resolve(m);
      else p?.reject(new Error(m.message));
      return;
    }
    if (m.type === "thumbs") {
      // Keep pictures not redrawn this time (cut short), drop those no longer in the strip.
      const thumbs: Record<string, Blob> = {};
      for (const k of m.keys) if (this.state.thumbs[k]) thumbs[k] = this.state.thumbs[k]!;
      for (const t of m.items) thumbs[t.key] = t.png;
      this.set({ thumbs });
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
