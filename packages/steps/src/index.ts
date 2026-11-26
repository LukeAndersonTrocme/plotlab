import { StepRegistry } from "@plotlab/engine";
import { threshold } from "./threshold/index.ts";
import { centerline } from "./centerline/index.ts";
import { order } from "./order/index.ts";
import { tone } from "./tone/index.ts";
import { levels } from "./levels/index.ts";
import { bands } from "./bands/index.ts";
import { fill } from "./fill/index.ts";
import { pixelate } from "./pixelate/index.ts";
import { cells } from "./cells/index.ts";
import { dither } from "./dither/index.ts";
import { reaction } from "./reaction/index.ts";
import { stipple } from "./stipple/index.ts";
import { cmyk } from "./cmyk/index.ts";

export { threshold, tone, levels, pixelate, bands, fill, centerline, order, cells, dither, reaction, stipple, cmyk };
export const allSteps = [threshold, tone, cmyk, levels, pixelate, centerline, bands, fill, order, cells, dither, reaction, stipple];
export function createRegistry(): StepRegistry {
  return new StepRegistry(allSteps);
}
export { CMYK_INKS, separatePixel } from "./cmyk/index.ts";
export { applyPreset, presets, presetSteps, type Preset } from "./presets.ts";
