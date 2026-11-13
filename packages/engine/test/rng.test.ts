import { describe, expect, it } from "vitest";
import { createRng, randomSeed, resolveParams, seedParam } from "../src/index.ts";

describe("createRng", () => {
  it("same seed gives the same sequence", () => {
    const a = createRng(42), b = createRng(42);
    const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
    expect(xs).toEqual(ys);
  });
  it("different seeds differ", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
  it("values are in [0, 1)", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe("seedParam", () => {
  it("validates with default 1 and is marked as a seed", () => {
    const decls = { seed: seedParam() };
    expect(resolveParams(decls, {}).values.seed).toBe(1);
    expect(decls.seed.seed).toBe(true);
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s <= 999999).toBe(true);
  });
});
