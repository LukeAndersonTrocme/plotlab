import type { Plot } from "./types.ts";

const r = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Plot → one SVG with Inkscape-compatible layers (one per pass, in pass order). Units are mm.
 * Layers that are not lines yet (`plot.rasterLayers`) are not included.
 * The recipe is embedded in <metadata> so every export carries its recipe.
 */
export function plotToSvg(plot: Plot, opts: { recipe?: unknown } = {}): string {
  const { widthMm: w, heightMm: h } = plot.paper;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
      ` width="${r(w)}mm" height="${r(h)}mm" viewBox="0 0 ${r(w)} ${r(h)}">`,
  );
  if (opts.recipe !== undefined) {
    out.push(`<metadata><plotlab:recipe xmlns:plotlab="https://plotlab.invalid/recipe">${esc(JSON.stringify(opts.recipe))}</plotlab:recipe></metadata>`);
  }
  plot.layers.forEach((layer, i) => {
    out.push(
      `<g inkscape:groupmode="layer" inkscape:label="${i + 1}-${esc(layer.name)}" id="layer-${esc(layer.id)}"` +
        ` fill="none" stroke="${esc(layer.ink.color)}" stroke-width="${r(layer.ink.widthMm)}" stroke-linecap="round" stroke-linejoin="round"` +
        (layer.ink.mix === "multiply" ? ` style="mix-blend-mode:multiply"` : "") +
        `>`,
    );
    for (const p of layer.paths) {
      if (p.length === 0) continue;
      const d = p.map(([x, y], j) => `${j === 0 ? "M" : "L"}${r(x)} ${r(y)}`).join(" ");
      out.push(`<path d="${d}"/>`);
    }
    out.push(`</g>`);
  });
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}
