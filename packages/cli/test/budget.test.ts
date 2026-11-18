import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBudget } from "../src/budget.ts";

describe("resolveBudget", () => {
  it("uses the recipe's budget when there is no flag", () => {
    expect(resolveBudget(undefined, { kind: "plotter", budgetMin: 5 })).toBe(5);
    expect(resolveBudget(undefined, { kind: "plotter" })).toBeUndefined();
  });
  it("--budget overrides the recipe for one run", () => {
    expect(resolveBudget("12.5", { kind: "plotter", budgetMin: 5 })).toBe(12.5);
    expect(resolveBudget("3", { kind: "plotter" })).toBe(3);
  });
  it("rejects a budget that isn't a positive number of minutes", () => {
    expect(() => resolveBudget("0", { kind: "plotter" })).toThrow(/--budget/);
    expect(() => resolveBudget("five", { kind: "plotter" })).toThrow(/--budget/);
  });
  it("is ignored for targets without a time readout", () => {
    expect(resolveBudget("5", { kind: "vector" })).toBeUndefined();
  });
});

describe("plotlab run --budget", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const run = (recipe: object, extra: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "plotlab-budget-"));
    const recipePath = join(dir, "r.json");
    writeFileSync(recipePath, JSON.stringify(recipe));
    const r = spawnSync(process.execPath, ["--import", "tsx", join(root, "packages/cli/src/main.ts"), "run", recipePath, "-i", join(root, "golden/fixtures/shapes.png"), "-o", join(dir, "out"), ...extra], {
      cwd: root,
      encoding: "utf8",
    });
    return { ...r, saved: JSON.parse(readFileSync(join(dir, "out", "recipe.json"), "utf8")) };
  };
  const base = JSON.parse(readFileSync(join(root, "golden/cases/shapes-centerline.recipe.json"), "utf8"));

  it("prints the check after the estimate, using the recipe budget or the flag", () => {
    const withBudget = { ...base, target: { kind: "plotter", budgetMin: 600 } };
    const a = run(withBudget, []);
    expect(a.status, a.stderr).toBe(0);
    expect(a.stdout).toMatch(/within the 600 min budget/);

    const b = run(withBudget, ["--budget", "0.01"]);
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout).toMatch(/over the 0\.01 min budget|× the 0\.01 min budget/);
    // The override is for this run only: the saved recipe keeps its own budget.
    expect(b.saved.target.budgetMin).toBe(600);

    const c = run(base, []);
    expect(c.stdout).not.toMatch(/min budget/);
  }, 60_000);
});
