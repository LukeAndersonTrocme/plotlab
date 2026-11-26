import { describe, expect, it } from "vitest";
import { createRegistry } from "@plotlab/steps";
import { splitSettings } from "../src/settings.ts";

const registry = createRegistry();
const paramsOf = (id: string) => registry.get(id)!.params;

describe("step settings: main first, More settings folded", () => {
  it("folds random seeds and per-band tables under More settings", () => {
    const fill = splitSettings(paramsOf("fill"));
    expect(fill.more).toEqual(["overrides"]);
    expect(fill.main[0]).toBe("kind");
    expect(splitSettings(paramsOf("stipple")).more).toEqual(["seed"]);
  });

  it("keeps declaration order and puts every setting somewhere", () => {
    const decls = paramsOf("fill");
    const { main, more } = splitSettings(decls);
    expect([...main, ...more].sort()).toEqual(Object.keys(decls).sort());
    expect(main).toEqual(Object.keys(decls).filter((k) => k !== "overrides"));
  });

  it("a step with only main settings has nothing to fold", () => {
    expect(splitSettings(paramsOf("threshold")).more).toEqual([]);
  });
});
