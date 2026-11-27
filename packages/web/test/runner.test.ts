import { describe, expect, it, vi } from "vitest";
import { defaultParams, Pipeline, StepError, type Plot, type RawImage } from "@plotlab/engine";
import { createRegistry, levels } from "@plotlab/steps";
import { defaultRecipe } from "../src/defaults.ts";
import type { FromWorker, ToWorker } from "../src/protocol.ts";

/** A stand-in for the pipeline worker: records what's sent, and lets the test answer. */
class FakeWorker {
  static last: FakeWorker;
  sent: ToWorker[] = [];
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  reply(m: FromWorker) {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
  terminate() {}
}
vi.stubGlobal("Worker", FakeWorker);
const { Runner } = await import("../src/runner.ts");

/** Threshold → Levels → Centerline → Stroke order (bug #85). */
function levelsRecipe() {
  const r = defaultRecipe();
  const lv = { id: "levels", step: "levels", version: levels.version, params: defaultParams(levels.params), enabled: true };
  return { ...r, steps: [r.steps[0]!, lv, ...r.steps.slice(1)] };
}

const plot: Plot = { kind: "plot", paper: { widthMm: 297, heightMm: 210 }, ordered: false, layers: [] } as unknown as Plot;
const estimate = { passes: [], penChanges: 0, penChangeS: 0, totalS: 1000 };
const result = (id: number): FromWorker => ({
  type: "result",
  id,
  proxy: false,
  plot,
  estimate,
  warnings: [],
  working: null,
  steps: [],
  stale: [],
  staleIds: [],
  rasterLayers: [],
  inspected: null,
  underlay: null,
  proof: null,
  compared: null,
});

describe("bug #85: Threshold → Levels → Centerline → Stroke order", () => {
  it("the recipe itself fails at Centerline: Levels makes categories, Centerline traces tone only", async () => {
    const img: RawImage = { width: 8, height: 8, channels: 1, data: Float32Array.from({ length: 64 }, (_, i) => (i % 8) / 8) };
    const run = new Pipeline(createRegistry()).run(img, levelsRecipe(), { runOnDemand: false });
    await expect(run).rejects.toBeInstanceOf(StepError);
    await expect(run).rejects.toMatchObject({ index: 2, message: expect.stringContaining("Centerline traces tone layers") });
  });

  it("a run that fails leaves no time estimate from an earlier recipe on screen", () => {
    const runner = new Runner(() => {});
    const w = FakeWorker.last;
    runner.request(defaultRecipe(), false);
    w.reply(result(1));
    expect(runner.state.estimate?.totalS).toBe(1000);

    runner.request(levelsRecipe(), false);
    w.reply({ type: "error", id: 2, index: 2, message: "Centerline traces tone layers…" });
    expect(runner.state.error?.index).toBe(2);
    // After a reload the same failing recipe shows no estimate; before it, neither should it.
    expect(runner.state.estimate).toBeNull();
  });
});
