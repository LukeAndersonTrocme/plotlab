import type { NumberParam } from "./params.ts";

/**
 * Seeded PRNG (mulberry32). Every random step takes a `seed` param and draws from
 * `createRng(seed)`, so the same recipe always gives the same result (ADR 0012).
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_MAX = 999999;

/** The standard seed parameter. The UI shows it with a reroll button. */
export function seedParam(label = "Seed"): NumberParam {
  return {
    type: "number",
    label,
    help: "Change this to get a different random variation. The same seed always gives the same result.",
    min: 0,
    max: SEED_MAX,
    step: 1,
    default: 1,
    unit: "",
    seed: true,
  };
}

/** A fresh seed for the reroll button (not for use inside steps). */
export function randomSeed(): number {
  return Math.floor(Math.random() * (SEED_MAX + 1));
}
