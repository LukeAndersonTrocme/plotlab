import { defineStep, type Ink, type Layers } from "@plotlab/engine";
import { help } from "../help.generated.ts";

const ink = (id: string, name: string, color: string): Ink => ({ id, name, color, mix: "multiply", widthMm: 0.3 });

/** Layer ids (stable: per-layer settings and lanes refer to them) and their default inks. */
export const CMYK_INKS: Record<"C" | "M" | "Y" | "K", Ink> = {
  C: ink("cyan", "Cyan", "#00a0d6"),
  M: ink("magenta", "Magenta", "#d6127a"),
  Y: ink("yellow", "Yellow", "#f0c400"),
  K: ink("black", "Black", "#1d1d1b"),
};

/**
 * Split one pixel into ink densities. C, M, Y start as 1 − R, G, B. Black generation `bg`
 * takes K = bg · min(C, M, Y) (the grey they share) and C, M, Y drop to (C − K) / (1 − K),
 * so the four inks multiplied together still give back the pixel.
 */
export function separatePixel(r: number, g: number, b: number, bg: number): [number, number, number, number] {
  const c = 1 - r, m = 1 - g, y = 1 - b;
  const k = bg * Math.min(c, m, y);
  if (k >= 1) return [0, 0, 0, 1];
  const under = (v: number) => Math.min(1, Math.max(0, (v - k) / (1 - k)));
  return [under(c), under(m), under(y), k];
}

export const cmyk = defineStep({
  id: "cmyk",
  version: 1,
  title: "Separate CMYK",
  summary: "Split the picture into four inks, cyan, magenta, yellow and black, like a four-colour print.",
  input: "image",
  output: "layers",
  cost: "live",
  params: {
    blackGeneration: {
      type: "number",
      label: "Black generation",
      help: "How much of the darkness cyan, magenta and yellow share moves into the black ink. 0 = no black, 1 = all of it.",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
    },
  },
  layerInks: CMYK_INKS,
  help: help.cmyk ?? "",
  run(img, p): Layers {
    const n = img.width * img.height;
    const ch = img.channels;
    const out = { C: new Float32Array(n), M: new Float32Array(n), Y: new Float32Array(n), K: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      const r = img.data[i * ch]!;
      const g = ch === 1 ? r : img.data[i * ch + 1]!;
      const b = ch === 1 ? r : img.data[i * ch + 2]!;
      const [c, m, y, k] = separatePixel(r, g, b, p.blackGeneration);
      out.C[i] = c;
      out.M[i] = m;
      out.Y[i] = y;
      out.K[i] = k;
    }
    const layers = (["C", "M", "Y", "K"] as const).map((id) => ({ id, name: CMYK_INKS[id].name, values: { kind: "tone" as const, data: out[id] } }));
    return { kind: "layers", width: img.width, height: img.height, frame: img.frame, layers };
  },
});
