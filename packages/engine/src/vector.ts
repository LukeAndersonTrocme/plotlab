import { zlibSync } from "fflate";
import { base64, concat, encodePng } from "./encode.ts";
import { parseColor } from "./project.ts";
import { imageToRGBA, layerToRGBA } from "./render.ts";
import type { Image, Ink, Layers, Plot } from "./types.ts";

/**
 * Vector documents (SVG/PDF) for the digital vector and plotter targets. Lines are strokes
 * at their ink width; layers that stopped before lines and a leftover image are embedded
 * as images on their frame, under the lines. `mirror` flips the whole page left-right.
 */
export interface VectorDoc {
  /** Lines, finished (registration marks included); mirroring is applied by the writer. */
  plot: Plot;
  rasters?: { layers: Layers; inkFor(layerId: string): Ink } | null;
  image?: Image | null;
  mirror?: boolean;
  recipe?: unknown;
}

const r = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One SVG with Inkscape-compatible layers (one per pass, in pass order). Units are mm. */
export function vectorToSvg(doc: VectorDoc): string {
  const { plot } = doc;
  const { widthMm: w, heightMm: h } = plot.paper;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
      ` width="${r(w)}mm" height="${r(h)}mm" viewBox="0 0 ${r(w)} ${r(h)}">`,
  );
  if (doc.recipe !== undefined) {
    out.push(`<metadata><plotlab:recipe xmlns:plotlab="https://plotlab.invalid/recipe">${esc(JSON.stringify(doc.recipe))}</plotlab:recipe></metadata>`);
  }
  if (doc.mirror) out.push(`<g transform="matrix(-1 0 0 1 ${r(w)} 0)">`);
  const img = (id: string, label: string, f: Layers["frame"], pw: number, ph: number, rgba: Uint8ClampedArray, mix: string, pixelated: boolean) =>
    out.push(
      `<g inkscape:groupmode="layer" inkscape:label="${esc(label)}" id="${esc(id)}"${mix === "multiply" ? ` style="mix-blend-mode:multiply"` : ""}>` +
        `<image x="${r(f.xMm)}" y="${r(f.yMm)}" width="${r(f.widthMm)}" height="${r(f.heightMm)}" preserveAspectRatio="none"` +
        (pixelated ? ` style="image-rendering:pixelated"` : "") +
        ` href="data:image/png;base64,${base64(encodePng({ width: pw, height: ph, format: "rgba", data: rgba }))}"/></g>`,
    );
  if (doc.image) img("image", "Image", doc.image.frame, doc.image.width, doc.image.height, imageToRGBA(doc.image), "normal", false);
  if (doc.rasters) {
    const ls = doc.rasters.layers;
    for (const l of ls.layers) {
      const ink = doc.rasters.inkFor(l.id);
      img(`raster-${l.id}`, `${l.name} (image)`, ls.frame, ls.width, ls.height, layerToRGBA(l, ls.width, ls.height, ink.color), ink.mix, l.values.kind === "categories");
    }
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
  if (doc.mirror) out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

/**
 * Plot → SVG (lines only). Layers that are not lines yet (`plot.rasterLayers`) are not
 * included; use `vectorToSvg` to embed them. The recipe rides along in <metadata>.
 */
export function plotToSvg(plot: Plot, opts: { recipe?: unknown } = {}): string {
  return vectorToSvg({ plot, recipe: opts.recipe });
}

const enc = new TextEncoder();
const hex = (s: string) => [...enc.encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A single-page PDF in the paper's size. Inks mix via blend modes (Multiply). */
export function vectorToPdf(doc: VectorDoc): Uint8Array {
  const { plot } = doc;
  const k = 72 / 25.4;
  const W = plot.paper.widthMm, H = plot.paper.heightMm;
  const objects: Array<Uint8Array | string> = [];
  const add = (o: Uint8Array | string) => (objects.push(o), objects.length);
  const stream = (dict: string, data: Uint8Array) => {
    const z = zlibSync(data, { level: 6 });
    return concat([enc.encode(`<< ${dict} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, enc.encode("\nendstream")]);
  };
  const catalog = add("");
  const pages = add("");
  const xobjects: string[] = [];
  const ops: string[] = [`${r(k)} 0 0 ${r(-k)} 0 ${r(H * k)} cm`];
  if (doc.mirror) ops.push(`-1 0 0 1 ${r(W)} 0 cm`);
  const placeImage = (name: string, f: Layers["frame"], gs: string) =>
    ops.push(`q /${gs} gs ${r(f.widthMm)} 0 0 ${r(-f.heightMm)} ${r(f.xMm)} ${r(f.yMm + f.heightMm)} cm /${name} Do Q`);
  if (doc.image) {
    const im = doc.image;
    const rgba = imageToRGBA(im);
    const rgb = new Uint8Array(im.width * im.height * 3);
    for (let i = 0; i < im.width * im.height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    const id = add(stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true`, rgb));
    xobjects.push(`/Im0 ${id} 0 R`);
    placeImage("Im0", im.frame, "GSn");
  }
  if (doc.rasters) {
    const ls = doc.rasters.layers;
    const n = ls.width * ls.height;
    ls.layers.forEach((l, i) => {
      const ink = doc.rasters!.inkFor(l.id);
      const [cr, cg, cb] = parseColor(ink.color) ?? [0, 0, 0];
      const rgba = layerToRGBA(l, ls.width, ls.height, ink.color);
      const rgb = new Uint8Array(n * 3), alpha = new Uint8Array(n);
      for (let j = 0; j < n; j++) {
        rgb[j * 3] = cr;
        rgb[j * 3 + 1] = cg;
        rgb[j * 3 + 2] = cb;
        alpha[j] = rgba[j * 4 + 3]!;
      }
      const interp = l.values.kind === "tone";
      const mask = add(stream(`/Type /XObject /Subtype /Image /Width ${ls.width} /Height ${ls.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate ${interp}`, alpha));
      const id = add(stream(`/Type /XObject /Subtype /Image /Width ${ls.width} /Height ${ls.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${interp} /SMask ${mask} 0 R`, rgb));
      xobjects.push(`/Im${i + 1} ${id} 0 R`);
      placeImage(`Im${i + 1}`, ls.frame, ink.mix === "multiply" ? "GSm" : "GSn");
    });
  }
  for (const layer of plot.layers) {
    const [cr, cg, cb] = (parseColor(layer.ink.color) ?? [0, 0, 0]).map((c) => r(c / 255));
    ops.push(`q /${layer.ink.mix === "multiply" ? "GSm" : "GSn"} gs ${cr} ${cg} ${cb} RG ${r(layer.ink.widthMm)} w 1 J 1 j`);
    for (const p of layer.paths) {
      if (p.length === 0) continue;
      const pts = p.length === 1 ? [p[0]!, p[0]!] : p;
      ops.push(pts.map(([x, y], j) => `${r(x)} ${r(y)} ${j === 0 ? "m" : "l"}`).join(" ") + " S");
    }
    ops.push("Q");
  }
  const content = add(stream("", enc.encode(ops.join("\n"))));
  const page = add(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${r(W * k)} ${r(H * k)}] /Contents ${content} 0 R` +
      ` /Resources << /ExtGState << /GSm << /BM /Multiply >> /GSn << /BM /Normal >> >> /XObject << ${xobjects.join(" ")} >> >> >>`,
  );
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  const info = add(`<< /Producer (plotlab)${doc.recipe !== undefined ? ` /PlotlabRecipe <${hex(JSON.stringify(doc.recipe))}>` : ""} >>`);

  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  let offset = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(offset);
    const body = typeof o === "string" ? enc.encode(o) : o;
    const chunk = concat([enc.encode(`${i + 1} 0 obj\n`), body, enc.encode("\nendobj\n")]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return concat(parts);
}
