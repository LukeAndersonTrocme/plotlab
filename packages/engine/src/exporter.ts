import { encodePng, encodeTiff } from "./encode.ts";
import { leftoverRasters } from "./layers.ts";
import { DEFAULT_PRINT, finishing, inkFor, type Target } from "./project.ts";
import { composite, finishPlot, paperPixels, printCoverage, renderPlates, type Rendered, type RenderSettings } from "./raster.ts";
import type { Recipe } from "./recipe.ts";
import type { Plot, StageData } from "./types.ts";
import { vectorToPdf, vectorToSvg } from "./vector.ts";

/**
 * Export (ADR 0007): the end of the chain → files for the project's target. One module so
 * the web app and the CLI write the same bytes.
 */
export type ExportFormat = "svg" | "pdf" | "png" | "tiff" | "plates";

export interface ExportFile {
  name: string;
  type: string;
  data: Uint8Array | string;
}

export interface ExportResult {
  files: ExportFile[];
  /** Plain-language notes, e.g. layers a plotter file had to leave out. */
  notes: string[];
}

/** What each target exports, first = the main button. */
export function exportFormats(target: Target): ExportFormat[] {
  switch (target.kind) {
    case "plotter":
      return ["svg"];
    case "vector":
      return ["svg", "pdf"];
    case "raster":
      return ["png", "tiff"];
    case "print":
      return ["plates"];
  }
}

export const FORMAT_LABEL: Record<ExportFormat, string> = { svg: "SVG", pdf: "PDF", png: "PNG", tiff: "TIFF", plates: "plates (.zip)" };

/** Longest side of the proof that comes with print plates. */
const PROOF_SIDE = 3000;

/** DPI for raster output; line targets proof at 300. */
export function exportDpi(target: Target): number {
  return "dpi" in target ? target.dpi : 300;
}

function settings(recipe: Recipe): RenderSettings {
  return { paper: recipe.paper, inks: recipe.inks, inkFor: (id) => inkFor(recipe, id), passOrder: recipe.passOrder, target: recipe.target };
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "ink";

/**
 * `plot` is the run's line output (null when nothing became lines); `output` is the last
 * stage, used for layers that stopped early and for a leftover image.
 */
export function exportOutput(output: StageData, plot: Plot | null, recipe: Recipe, format: ExportFormat, stem: string): ExportResult {
  const notes: string[] = [];
  const t = recipe.target;
  const lines: Plot = plot ?? { kind: "plot", paper: recipe.paper, layers: [], ordered: false };
  if (format === "svg" || format === "pdf") {
    const fin = finishing(t);
    const { image, layers } = leftoverRasters(output);
    const withRasters = t.kind !== "plotter";
    if (!withRasters && (image || layers)) {
      const names = [...(image ? ["the image"] : []), ...(layers?.layers.map((l) => l.name) ?? [])];
      notes.push(`Not lines yet, so left out of the plotter file: ${names.join(", ")}.`);
    }
    const doc = {
      plot: finishPlot(lines, { mirror: false, registration: fin.registration }),
      rasters: withRasters && layers ? { layers, inkFor: (id: string) => inkFor(recipe, id) } : null,
      image: withRasters ? image : null,
      mirror: fin.mirror,
      recipe,
    };
    return format === "svg"
      ? { files: [{ name: `${stem}.svg`, type: "image/svg+xml", data: vectorToSvg(doc) }], notes }
      : { files: [{ name: `${stem}.pdf`, type: "application/pdf", data: vectorToPdf(doc) }], notes };
  }
  const dpi = exportDpi(t);
  const r = renderPlates(output, plot, settings(recipe), dpi);
  if (format === "png" || format === "tiff") {
    const px = { width: r.width, height: r.height, format: "rgba" as const, data: composite(r) };
    if (format === "png") return { files: [{ name: `${stem}.png`, type: "image/png", data: encodePng(px, dpi) }], notes };
    const rgb = new Uint8Array(r.width * r.height * 3);
    for (let i = 0; i < r.width * r.height; i++) rgb.set(px.data.subarray(i * 4, i * 4 + 3), i * 3);
    return { files: [{ name: `${stem}.tif`, type: "image/tiff", data: encodeTiff({ width: r.width, height: r.height, format: "rgb", data: rgb }, dpi) }], notes };
  }
  // Print prep: one file per ink, plus a proof of how they print together.
  const opts = t.kind === "print" ? t : { ...DEFAULT_PRINT };
  if (r.image) notes.push("The image never became ink layers, so it has no plate. Add Ink density (or another layer step).");
  if (r.plates.length === 0) notes.push("Nothing to print: no layers or lines reach the end of the chain.");
  const files: ExportFile[] = [];
  const finals = r.plates.map((p) => ({ ink: p.ink, coverage: printCoverage(p, r, opts) }));
  finals.forEach((p, i) => {
    const n = p.coverage.length;
    const data = new Uint8Array(n);
    if (opts.mode === "gray") for (let j = 0; j < n; j++) data[j] = opts.negative ? p.coverage[j]! : 255 - p.coverage[j]!;
    else for (let j = 0; j < n; j++) data[j] = (p.coverage[j]! !== 0) !== opts.negative ? 1 : 0;
    const format = opts.mode === "gray" ? "gray" : "bitmap";
    files.push({ name: `${stem}-${i + 1}-${safe(p.ink.name)}.tif`, type: "image/tiff", data: encodeTiff({ width: r.width, height: r.height, format, data }, dpi) });
  });
  // The proof is for looking at, not printing: drawn again at screen-ish resolution.
  const proof = exportProof(output, plot, recipe, PROOF_SIDE);
  files.push({ name: `${stem}-proof.png`, type: "image/png", data: encodePng({ width: proof.width, height: proof.height, format: "rgba", data: proof.rgba }, proof.dpi) });
  return { files, notes };
}

/**
 * The page as it will export, for the preview: raster targets at their DPI, line targets
 * at 300 dpi, capped so the longest side stays under `maxSide` pixels. Print prep shows
 * the plates as they will print (threshold or halftone).
 */
export function exportProof(output: StageData, plot: Plot | null, recipe: Recipe, maxSide = 2400): { width: number; height: number; rgba: Uint8ClampedArray; dpi: number } {
  const t = recipe.target;
  let dpi = exportDpi(t);
  const full = paperPixels(recipe.paper, dpi);
  const scale = Math.min(1, maxSide / Math.max(full.width, full.height));
  // A scaled proof keeps the screen ruling in mm, so halftone dots shrink with it.
  dpi *= scale;
  // A plotter only draws lines: layers that stopped early don't appear on its proof.
  const lines: Plot | null = plot ? { ...plot, rasterLayers: undefined } : null;
  const source: StageData = t.kind === "plotter" ? (lines ?? { kind: "plot", paper: recipe.paper, layers: [], ordered: false }) : output;
  const r: Rendered = renderPlates(source, t.kind === "plotter" ? lines : plot, settings(recipe), dpi);
  const plates = t.kind === "print" ? r.plates.map((p) => ({ ink: p.ink, coverage: printCoverage(p, r, t) })) : r.plates;
  return { width: r.width, height: r.height, rgba: composite(r, plates), dpi };
}
