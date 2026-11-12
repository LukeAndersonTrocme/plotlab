import { StepRegistry } from "@plotlab/engine";
import { threshold } from "./threshold/index.ts";
import { centerline } from "./centerline/index.ts";
import { order } from "./order/index.ts";
import { tone } from "./tone/index.ts";
import { levels } from "./levels/index.ts";
import { bands } from "./bands/index.ts";

export { threshold, tone, levels, bands, centerline, order };
export const allSteps = [threshold, tone, levels, centerline, bands, order];
export function createRegistry(): StepRegistry {
  return new StepRegistry(allSteps);
}
