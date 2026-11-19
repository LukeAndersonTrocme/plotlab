import { describe, expect, it, vi } from "vitest";
import { applyStep, defineStep, loadRecipe, Pipeline, StepRegistry, type Layer, type Layers, type RawImage, type StepContext, type StepWarning } from "../src/index.ts";

const img: RawImage = { width: 2, height: 2, channels: 1, data: new Float32Array([0, 0, 0, 0]) };
const base = { schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "p", widthMm: 0.5, color: "#000" }] };

function makeRegistry(spy = vi.fn()) {
  const quiet = defineStep({
    id: "quiet", version: 1, title: "Quiet", summary: "", input: "image", output: "image", cost: "live", help: "", params: {},
    run: (i) => i,
  });
  const loud = defineStep({
    id: "loud", version: 1, title: "Loud", summary: "", input: "image", output: "image", cost: "live", help: "",
    params: { n: { type: "number", label: "n", help: "", min: 0, max: 10, default: 1 } },
    run: (i, p, ctx) => {
      spy();
      // The same message several times, as a loop might: reported once.
      for (let k = 0; k < 3; k++) ctx.warn?.("Stopped early.");
      if (p.n > 1) ctx.warn?.(`Asked for ${p.n}.`);
      return i;
    },
  });
  const split = defineStep({
    id: "split", version: 1, title: "Split", summary: "", input: "image", output: "layers", cost: "live", help: "", params: {},
    run: (i): Layers => {
      const l = (id: string): Layer => ({ id, name: id.toUpperCase(), values: { kind: "tone", data: new Float32Array(i.width * i.height) } });
      return { kind: "layers", width: i.width, height: i.height, frame: i.frame, layers: [l("a"), l("b")] };
    },
  });
  const perLayer = defineStep({
    id: "per-layer", version: 1, title: "Per layer", summary: "", input: "layers", output: "layers", cost: "live", help: "", params: {},
    runLayer: (l, _p, ctx) => {
      ctx.warn?.("Too much.");
      if (l.id === "b") ctx.warn?.("Only on b.");
      return l;
    },
  });
  return new StepRegistry([quiet, loud, split, perLayer]);
}

const recipe = (steps: unknown[], reg: StepRegistry) => loadRecipe({ ...base, steps }, reg).recipe;

describe("step warnings", () => {
  it("a warning from a step shows on that step's result, by its index in the recipe", async () => {
    const reg = makeRegistry();
    const out = await new Pipeline(reg).run(img, recipe([{ step: "quiet" }, { step: "loud" }], reg));
    expect(out.results.map((r) => r.warnings)).toEqual([[], [{ message: "Stopped early." }]]);
    expect(out.results[1]!.index).toBe(1);
  });

  it("identical messages from one step are reported once", async () => {
    const reg = makeRegistry();
    const out = await new Pipeline(reg).run(img, recipe([{ step: "loud", params: { n: 4 } }], reg));
    expect(out.results[0]!.warnings).toEqual([{ message: "Stopped early." }, { message: "Asked for 4." }]);
  });

  it("a cached step still reports its warnings", async () => {
    const spy = vi.fn();
    const reg = makeRegistry(spy);
    const p = new Pipeline(reg);
    const r = recipe([{ step: "loud", params: { n: 2 } }, { step: "quiet" }], reg);
    await p.run(img, r);
    const again = await p.run(img, r);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(again.results[0]!.cached).toBe(true);
    expect(again.results[0]!.warnings).toEqual([{ message: "Stopped early." }, { message: "Asked for 2." }]);
  });

  it("a re-run with new params replaces the old warnings", async () => {
    const reg = makeRegistry();
    const p = new Pipeline(reg);
    await p.run(img, recipe([{ step: "loud", params: { n: 5 } }], reg));
    const out = await p.run(img, recipe([{ step: "loud", params: { n: 1 } }], reg));
    expect(out.results[0]!.warnings).toEqual([{ message: "Stopped early." }]);
  });

  it("per-layer runs tag each warning with its layer id", async () => {
    const reg = makeRegistry();
    const out = await new Pipeline(reg).run(img, recipe([{ step: "split" }, { step: "per-layer" }], reg));
    expect(out.results[1]!.warnings).toEqual([
      { message: "Too much.", layer: "a" },
      { message: "Too much.", layer: "b" },
      { message: "Only on b.", layer: "b" },
    ]);
  });

  it("applyStep collects warnings into a list when given one, and passes ctx.warn through otherwise", async () => {
    const reg = makeRegistry();
    const loud = reg.get("loud")!;
    const placed = (await new Pipeline(reg).run(img, recipe([], reg))).placed;
    const ctx = { paper: base.paper, target: { kind: "plotter" }, inks: [], inkFor: () => undefined, passOrder: "light-to-dark" } as unknown as StepContext;
    const list: StepWarning[] = [];
    await applyStep(loud, placed, { params: { n: 1 } }, ctx, list);
    expect(list).toEqual([{ message: "Stopped early." }]);
    const seen: string[] = [];
    await applyStep(loud, placed, { params: { n: 1 } }, { ...ctx, warn: (m) => seen.push(m) });
    expect(seen).toEqual(["Stopped early.", "Stopped early.", "Stopped early."]);
  });
});
