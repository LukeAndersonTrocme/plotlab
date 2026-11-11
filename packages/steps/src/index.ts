import { StepRegistry } from "@plotlab/engine";
import { threshold } from "./threshold/index.ts";
import { centerline } from "./centerline/index.ts";
import { plot } from "./plot/index.ts";

export { threshold, centerline, plot };
export const allSteps = [threshold, centerline, plot];
export function createRegistry(): StepRegistry {
  return new StepRegistry(allSteps);
}
