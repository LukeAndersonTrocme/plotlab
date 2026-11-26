import { describe, expect, it } from "vitest";
import { checkChain, loadRecipe, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { addAt, addMenu, dragHint, dropGaps, moveToGap, stageAt } from "../src/gaps.ts";

const reg = createRegistry();
const recipe = (steps: Array<string | { step: string; enabled?: boolean }>, input?: "image" | "layers" | "geometry"): Recipe =>
  loadRecipe(
    {
      schemaVersion: 3,
      ...(input ? { input } : {}),
      paper: { widthMm: 210, heightMm: 297 },
      inks: [{ id: "k", color: "#000" }],
      steps: steps.map((s) => (typeof s === "string" ? { step: s } : s)),
    },
    reg,
  ).recipe;
const ids = (r: Recipe) => r.steps.map((s) => s.id);
const fitsEverywhere = (r: Recipe) => expect(checkChain(r.input, r.steps, reg)).toEqual([]);

// The default chain: Threshold (image → layers), Centerline (layers → lines), Stroke order (lines → plot).
const base = recipe(["threshold", "centerline", "order"]);

describe("stageAt: what the chain has at a gap", () => {
  it("gap 0 is right after the source; each gap after that follows a step", () => {
    expect([0, 1, 2, 3].map((g) => stageAt(base, reg, g))).toEqual(["image", "layers", "geometry", "plot"]);
  });

  it("a switched-off step passes its input through", () => {
    const r = recipe(["tone", { step: "levels", enabled: false }, "bands"]);
    expect(stageAt(r, reg, 2)).toBe("layers");
  });

  it("starts at the entry stage", () => {
    expect(stageAt(recipe(["fill", "order"], "geometry"), reg, 0)).toBe("geometry");
  });
});

describe("addMenu: the steps a '+' offers", () => {
  const offered = (r: Recipe, gap: number) => addMenu(r, reg, gap).options.map((o) => o.id).sort();

  it("after the source, only steps that keep it an image (the next step needs one)", () => {
    expect(offered(base, 0)).toEqual(["reaction"]);
  });

  it("between Threshold and Centerline, the steps that work on layers and keep them layers", () => {
    expect(offered(base, 1)).toEqual(["levels", "pixelate"]);
  });

  it("between Centerline and Stroke order, steps that work on lines", () => {
    expect(offered(base, 2)).toEqual(["fill"]);
  });

  it("each option shows its stage out, title, icon and summary", () => {
    const fill = addMenu(base, reg, 2).options[0]!;
    expect(fill).toMatchObject({ id: "fill", title: "Fill", output: "geometry", experimental: false });
    expect(fill.icon).not.toBe("");
    expect(fill.summary).not.toBe("");
  });

  it("with no steps after it, anything that takes what the chain has", () => {
    const r = recipe(["tone"]);
    expect(offered(r, 1)).toEqual(["bands", "cells", "centerline", "levels", "pixelate", "stipple"]);
    expect(offered(recipe([]), 0)).toEqual(["cmyk", "dither", "reaction", "threshold", "tone"]);
  });

  it("offers exactly the steps insertStep accepts at that gap, and every one keeps the chain valid", () => {
    for (const r of [base, recipe(["tone", "levels", "bands", "fill", "order"]), recipe([])]) {
      for (let gap = 0; gap <= r.steps.length; gap++) {
        const menu = addMenu(r, reg, gap);
        for (const o of menu.options) {
          const res = addAt(r, reg, gap, o.id);
          if ("reason" in res) throw new Error(res.reason);
          fitsEverywhere(res.recipe);
        }
        const others = reg.list().filter((d) => !menu.options.some((o) => o.id === d.id));
        for (const d of others) expect("reason" in addAt(r, reg, gap, d.id)).toBe(true);
      }
    }
  });

  it("when nothing fits it says why, in stage words", () => {
    const end = addMenu(base, reg, 3);
    expect(end.options).toEqual([]);
    expect(end.reason).toBe(
      "Nothing fits here: at this point the chain has a plot, and no step works on a plot. Each step turns one kind of data into the next: an image → layers → lines → a plot.",
    );
  });

  it("when the chain doesn't fit together yet, says so instead", () => {
    // Pixelate needs layers, but an image chain starts with an image.
    const ok = recipe(["tone", "pixelate"]);
    const r = { ...ok, steps: [ok.steps[1]!, ok.steps[0]!] };
    const m = addMenu(r, reg, 2);
    expect(m.options).toEqual([]);
    expect(m.reason).toMatch(/^Nothing fits here until the chain fits together: Pixelate needs layers, but at that point the chain has an image\./);
  });
});

describe("addAt", () => {
  it("puts the step at the gap with a fresh id", () => {
    const res = addAt(base, reg, 1, "levels");
    if ("reason" in res) throw new Error(res.reason);
    expect(ids(res.recipe)).toEqual(["threshold", "levels", "centerline", "order"]);
    expect(res.id).toBe("levels");
    const again = addAt(res.recipe, reg, 1, "levels");
    if ("reason" in again) throw new Error(again.reason);
    expect(again.id).not.toBe("levels");
    expect(again.recipe.steps[1]!.id).toBe(again.id);
  });

  it("adds the step's default inks (Separate CMYK brings C, M, Y and K)", () => {
    const res = addAt(recipe([]), reg, 0, "cmyk");
    if ("reason" in res) throw new Error(res.reason);
    expect(res.recipe.inks.length).toBeGreaterThan(1);
    expect(Object.keys(res.recipe.layerInks ?? {}).length).toBeGreaterThan(0);
  });

  it("never applies a step that doesn't fit at that gap", () => {
    const res = addAt(base, reg, 0, "fill");
    expect("reason" in res && res.reason).toMatch(/Fill needs lines/);
  });
});

describe("dropGaps: where a dragged step can go", () => {
  it("skips the two gaps beside the step itself (dropping there changes nothing)", () => {
    const r = recipe(["tone", "levels", "pixelate", "bands", "order"]);
    expect(dropGaps(r, reg, 1).map((g) => g.gap)).toEqual([0, 3, 4, 5]);
  });

  it("marks only the gaps where the chain stays valid", () => {
    // Levels and Pixelate both work on layers: each can sit either side of the other.
    const r = recipe(["tone", "levels", "pixelate", "bands", "order"]);
    expect(dropGaps(r, reg, 1).filter((g) => g.ok).map((g) => g.gap)).toEqual([3]);
    expect(dropGaps(r, reg, 2).filter((g) => g.ok).map((g) => g.gap)).toEqual([1]);
  });

  it("a stage-changing step usually has nowhere else to go; invalid gaps carry the reason", () => {
    const gaps = dropGaps(base, reg, 1);
    expect(gaps.every((g) => !g.ok)).toBe(true);
    expect(gaps[0]!.reason).toMatch(/needs (layers|an image|lines)/);
  });

  it("every gap marked ok really moves the step, and the chain stays valid", () => {
    const r = recipe(["tone", "levels", "pixelate", "bands", "fill", "order"]);
    r.steps.forEach((_, from) => {
      for (const g of dropGaps(r, reg, from)) {
        const res = moveToGap(r, reg, from, g.gap);
        expect("recipe" in res).toBe(g.ok);
        if ("recipe" in res) fitsEverywhere(res.recipe);
      }
    });
  });
});

describe("moveToGap", () => {
  const r = recipe(["tone", "levels", "pixelate", "bands", "order"]);

  it("moves a step to the right: it lands just before the step after the gap", () => {
    const res = moveToGap(r, reg, 1, 3);
    if ("reason" in res) throw new Error(res.reason);
    expect(ids(res.recipe)).toEqual(["tone", "pixelate", "levels", "bands", "order"]);
  });

  it("moves a step to the left", () => {
    const res = moveToGap(r, reg, 2, 1);
    if ("reason" in res) throw new Error(res.reason);
    expect(ids(res.recipe)).toEqual(["tone", "pixelate", "levels", "bands", "order"]);
  });

  it("refuses an invalid gap with the chain's reason, and leaves the recipe alone", () => {
    const res = moveToGap(r, reg, 1, 0);
    expect("reason" in res && res.reason).toMatch(/Levels needs layers, but at that point the chain has an image/);
    expect(ids(r)).toEqual(["tone", "levels", "pixelate", "bands", "order"]);
  });
});

describe("dragHint", () => {
  it("says how many places the step can go", () => {
    const r = recipe(["tone", "levels", "pixelate", "bands", "order"]);
    expect(dragHint(r, reg, 1)).toBe("Levels can go in 1 other place: the highlighted gap.");
    const two = recipe(["tone", "levels", "pixelate", "levels", "bands", "order"]);
    expect(dragHint(two, reg, 2)).toBe("Pixelate can go in 2 other places: the highlighted gaps.");
  });

  it("says why when there is nowhere else, in stage words", () => {
    expect(dragHint(base, reg, 1)).toBe("Centerline has nowhere else to go: it turns layers into lines, and only fits where the chain has layers.");
  });
});
