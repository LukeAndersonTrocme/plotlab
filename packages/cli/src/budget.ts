import { showsTime, type Target } from "@plotlab/engine";

/**
 * The time budget for this run, in minutes: `--budget` if given (this run only),
 * else the recipe's. Only targets with a time readout have one.
 */
export function resolveBudget(flag: string | undefined, target: Target, warn: (message: string) => void = () => {}): number | undefined {
  if (flag !== undefined) {
    const n = Number(flag);
    if (!(Number.isFinite(n) && n > 0)) throw new Error(`--budget must be a positive number of minutes, got "${flag}"`);
    if (showsTime(target)) return n;
    warn(`--budget only applies to plotter targets (this recipe's target is ${target.kind}); ignoring it`);
  }
  if (!showsTime(target)) return undefined;
  return target.kind === "plotter" ? target.budgetMin : undefined;
}
