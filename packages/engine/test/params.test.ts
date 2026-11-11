import { describe, expect, it } from "vitest";
import { defaultParams, isVisible, resolveParams, type ParamDecls } from "../src/index.ts";

const decls = {
  mode: { type: "enum", label: "Mode", help: "", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
  level: { type: "number", label: "Level", help: "", min: 0, max: 10, default: 5, visibleWhen: { param: "mode", equals: ["a"] } },
  flip: { type: "boolean", label: "Flip", help: "", default: false },
} satisfies ParamDecls;

describe("params", () => {
  it("fills defaults", () => {
    expect(defaultParams(decls)).toEqual({ mode: "a", level: 5, flip: false });
    expect(resolveParams(decls, {}).issues).toEqual([]);
  });
  it("clamps out-of-range numbers and reports it", () => {
    const r = resolveParams(decls, { level: 99 });
    expect(r.values.level).toBe(10);
    expect(r.issues[0]?.message).toMatch(/clamped/);
  });
  it("rejects unknown keys, bad enums and wrong types", () => {
    const r = resolveParams(decls, { nope: 1, mode: "z", flip: "yes" });
    expect(r.issues.map((i) => i.param).sort()).toEqual(["flip", "mode", "nope"]);
    expect(r.values).toEqual({ mode: "a", level: 5, flip: false });
  });
  it("conditional visibility", () => {
    expect(isVisible(decls, "level", { mode: "a" })).toBe(true);
    expect(isVisible(decls, "level", { mode: "b" })).toBe(false);
    expect(isVisible(decls, "flip", { mode: "b" })).toBe(true);
  });
});
