/**
 * A ~160 px PNG of the main view, for a checkpoint. The view is an SVG whose rasters are
 * blob: URLs and whose colours come from the stylesheet; an SVG drawn as an image can't
 * reach either, so the copy gets its rasters inlined as data: URLs and its styles inlined.
 */
const STYLED = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-family"] as const;

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export async function captureThumbnail(svg: SVGSVGElement, size = 160): Promise<Uint8Array | undefined> {
  const vb = svg.viewBox.baseVal;
  if (!vb || !vb.width || !vb.height) return undefined;
  const scale = size / Math.max(vb.width, vb.height);
  const w = Math.max(1, Math.round(vb.width * scale)), h = Math.max(1, Math.round(vb.height * scale));

  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(w));
  copy.setAttribute("height", String(h));
  // Styles from classes (paper, travel lines, empty text) → inline, in the same order.
  const from = [...svg.querySelectorAll<SVGElement>("[class]")];
  const to = [...copy.querySelectorAll<SVGElement>("[class]")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of STYLED) to[i]?.style.setProperty(p, cs.getPropertyValue(p));
    to[i]?.style.setProperty("filter", "none");
  });
  // Pen lines are a fraction of a pixel at this size: keep them at least 1 px so they show.
  for (const p of copy.querySelectorAll("path[stroke-width]")) {
    const sw = Number(p.getAttribute("stroke-width"));
    if (sw > 0) p.setAttribute("stroke-width", String(Math.max(sw, 1 / scale)));
  }
  await Promise.all(
    [...copy.querySelectorAll("image")].map(async (img) => {
      const href = img.getAttribute("href");
      if (href?.startsWith("blob:")) img.setAttribute("href", await dataUrl(await (await fetch(href)).blob()));
    }),
  );

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    g.fillStyle = getComputedStyle(document.body).backgroundColor || "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? new Uint8Array(await png.arrayBuffer()) : undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
