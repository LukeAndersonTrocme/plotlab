import { describe, expect, it, vi } from "vitest";
import { defineStep, loadRecipe, Pipeline, placeOnPaper, RecipeError, StepRegistry, type Layers, type RawImage } from "../src/index.ts";

const img: RawImage = { width: 1, height: 1, channels: 1, data: new Float32Array([0]) };

function makeRegistry(spy = vi.fn()) {
  const a = defineStep({
    id: "a", version: 2, title: "A", summary: "", input: "image", output: "image", cost: "live", help: "",
    params: { k: { type: "number", label: "k", help: "", min: 0, max: 10, default: 1 } },
    run: (i) => { spy("a"); return i; },
    migrate: (p) => ({ params: { k: p.oldK }, note: "renamed oldK → k" }),
  });
  const b = defineStep({
    id: "b", version: 1, title: "B", summary: "", input: "image", output: "layers", cost: "live", help: "", params: {},
    run: (i): Layers => { spy("b"); return { kind: "layers", width: i.width, height: i.height, layers: [], frame: i.frame }; },
  });
  return new StepRegistry([a, b]);
}

const base = { schemaVersion: 2, paper: { widthMm: 100, heightMm: 100 }, inks: [{ id: "p", widthMm: 0.5, color: "#000" }] };

describe("loadRecipe", () => {
  it("migrates old step versions with a warning", () => {
    const { recipe, warnings } = loadRecipe({ ...base, steps: [{ step: "a", version: 1, params: { oldK: 3 } }] }, makeRegistry());
    expect(recipe.steps[0]).toMatchObject({ step: "a", version: 2, params: { k: 3 } });
    expect(warnings[0]?.message).toMatch(/upgraded v1 → v2/);
  });
  it("rejects unknown steps, future versions and type mismatches", () => {
    const bad = { ...base, steps: [{ step: "zzz" }, { step: "a", version: 9 }, { step: "b" }, { step: "b" }] };
    try {
      loadRecipe(bad, makeRegistry());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RecipeError);
      const msgs = (e as RecipeError).issues.map((i) => i.message).join("\n");
      expect(msgs).toMatch(/unknown step "zzz"/);
      expect(msgs).toMatch(/newer than this build/);
      expect(msgs).toMatch(/b expects image but receives layers/);
    }
  });
  it("rejects recipes from a newer schema", () => {
    expect(() => loadRecipe({ ...base, schemaVersion: 99, steps: [] }, makeRegistry())).toThrow(/newer/);
  });
});

describe("Pipeline", () => {
  it("only recomputes steps after the one that changed", async () => {
    const spy = vi.fn();
    const reg = makeRegistry(spy);
    const p = new Pipeline(reg);
    const r1 = loadRecipe({ ...base, steps: [{ step: "a", params: { k: 1 } }, { step: "b" }] }, reg).recipe;
    await p.run(img, r1);
    expect(spy.mock.calls.flat()).toEqual(["a", "b"]);
    spy.mockClear();
    await p.run(img, r1);
    expect(spy).not.toHaveBeenCalled();
    const r2 = loadRecipe({ ...base, steps: [{ step: "a", params: { k: 2 } }, { step: "b" }] }, reg).recipe;
    await p.run(img, r2);
    expect(spy.mock.calls.flat()).toEqual(["a", "b"]);
  });
  it("places the source on paper before step 1, at full or proxy resolution", async () => {
    const seen: Array<{ width: number; frame: unknown }> = [];
    const probe = defineStep({
      id: "probe", version: 1, title: "Probe", summary: "", input: "image", output: "image", cost: "live", help: "", params: {},
      run: (i) => { seen.push({ width: i.width, frame: i.frame }); return i; },
    });
    const reg = new StepRegistry([probe]);
    const big: RawImage = { width: 400, height: 200, channels: 1, data: new Float32Array(400 * 200) };
    const recipe = loadRecipe({ ...base, workingMmPerPx: 0.1, steps: [{ step: "probe" }] }, reg).recipe;
    const { placed } = await new Pipeline(reg).run(big, recipe);
    const expected = placeOnPaper(big, recipe.paper, recipe.layout).frame;
    expect(seen[0]!.frame).toEqual(expected);
    expect(placed.width).toBe(400);
    const proxied = await new Pipeline(reg).run(big, recipe, { maxSidePx: 100 });
    expect(proxied.placed.width).toBeLessThanOrEqual(100);
    expect(proxied.placed.frame).toEqual(expected);
  });
  it("holds back stale on-demand steps when asked, reusing them when still fresh", async () => {
    const spy = vi.fn();
    const slow = defineStep({
      id: "slow", version: 1, title: "Slow", summary: "", input: "image", output: "image", cost: "on-demand", help: "",
      params: { k: { type: "number", label: "k", help: "", min: 0, max: 10, default: 1 } },
      run: (i) => { spy("slow"); return i; },
    });
    const reg = new StepRegistry([slow]);
    const p = new Pipeline(reg);
    const r = loadRecipe({ ...base, steps: [{ step: "slow" }] }, reg).recipe;
    const held = await p.run(img, r, { runOnDemand: false });
    expect(spy).not.toHaveBeenCalled();
    expect(held.stale).toEqual([0]);
    expect(held.output.kind).toBe("image");
    await p.run(img, r); // the person presses Run
    expect(spy).toHaveBeenCalledTimes(1);
    const again = await p.run(img, r, { runOnDemand: false });
    expect(again.stale).toEqual([]);
    expect(again.results[0]!.cached).toBe(true);
  });
});
