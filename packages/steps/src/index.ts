import { StepRegistry } from "@plotlab/engine";
import { threshold } from "./threshold/index.ts";
import { centerline } from "./centerline/index.ts";
import { order } from "./order/index.ts";

export { threshold, centerline, order };
export const allSteps = [threshold, centerline, order];
export function createRegistry(): StepRegistry {
  return new StepRegistry(allSteps);
}
