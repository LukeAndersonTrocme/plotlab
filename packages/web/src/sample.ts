import { decodeTiffSource, imageFromRGBA, isTiff, parseSvg, type RawImage, type Source } from "@plotlab/engine";

/** The Mona Lisa face crop (public domain), falling back to drawn text if it can't load. */
export async function loadSample(): Promise<Source> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sample-mona-lisa.jpg`);
    if (res.ok) return await decodeFile(new File([await res.blob()], "sample-mona-lisa.jpg"));
  } catch {
    /* fall back */
  }
  return textSample();
}

function textSample(): RawImage {
  const w = 900, h = 450;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#000";
  g.font = "bold 190px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("plot", w / 2, h / 2 - 40);
  g.font = "italic 70px Georgia, serif";
  g.fillText("drop an image here", w / 2, h / 2 + 120);
  const d = g.getImageData(0, 0, w, h);
  return imageFromRGBA(w, h, d.data);
}

/**
 * PNG, JPEG, WebP… via the browser. TIFF (8/16-bit) and SVG via the engine, the same code
 * the CLI runs: a multi-page TIFF enters as layers, an SVG as lines.
 */
export async function decodeFile(file: File, warn: (m: string) => void = () => {}): Promise<Source> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (isTiff(head)) return decodeTiffSource(new Uint8Array(await file.arrayBuffer()));
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name) || /<svg[\s>]/.test(new TextDecoder().decode(head))) {
    const { geometry, warnings } = parseSvg(await file.text());
    warnings.forEach(warn);
    return geometry;
  }
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return imageFromRGBA(bmp.width, bmp.height, d.data);
}
