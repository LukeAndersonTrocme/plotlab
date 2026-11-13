import { defineStep, luminance, type Layers } from "@plotlab/engine";
import { help } from "../help.generated.ts";

export const tone = defineStep({
  id: "tone",
  version: 1,
  title: "Ink density",
  summary: "Turn the image into one layer of ink density: dark areas get more ink, light areas less.",
  input: "image",
  output: "layers",
  cost: "live",
  params: {
    contrast: {
      type: "number",
      label: "Contrast",
      help: "Above 1 pushes tones toward full ink or bare paper; below 1 flattens them.",
      min: 0.2,
      max: 5,
      step: 0.05,
      default: 1,
    },
    invert: { type: "boolean", label: "Invert", help: "Put ink on the light areas instead.", default: false },
  },
  help: help.tone ?? "",
  run(img, p): Layers {
    const lum = luminance(img);
    const data = new Float32Array(lum.length);
    for (let i = 0; i < data.length; i++) {
      const t = p.invert ? lum[i]! : 1 - lum[i]!;
      data[i] = Math.min(1, Math.max(0, (t - 0.5) * p.contrast + 0.5));
    }
    return { kind: "layers", width: img.width, height: img.height, frame: img.frame, layers: [{ id: "tone", name: "Ink density", values: { kind: "tone", data } }] };
  },
});
