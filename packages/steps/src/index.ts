import { StepRegistry } from "@plotlab/engine";
import { threshold } from "./threshold/index.ts";
import { centerline } from "./centerline/index.ts";
import { order } from "./order/index.ts";
import { tone } from "./tone/index.ts";
import { levels } from "./levels/index.ts";
import { bands } from "./bands/index.ts";
import { fill } from "./fill/index.ts";
import { pixelate } from "./pixelate/index.ts";

export { threshold, tone, levels, pixelate, bands, fill, centerline, order };
export const allSteps = [threshold, tone, levels, pixelate, centerline, bands, fill, order];
export function createRegistry(): StepRegistry {
  return new StepRegistry(allSteps);
}
