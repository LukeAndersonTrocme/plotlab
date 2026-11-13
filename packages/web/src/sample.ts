import { decodeTiff, imageFromRGBA, isTiff, type RawImage } from "@plotlab/engine";

/** The Mona Lisa face crop (public domain), falling back to drawn text if it can't load. */
export async function loadSample(): Promise<RawImage> {
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

/** PNG, JPEG, WebP… via the browser; TIFF (8/16-bit) via the engine, first page. */
export async function decodeFile(file: File, warn: (m: string) => void = () => {}): Promise<RawImage> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isTiff(head)) {
    const pages = decodeTiff(new Uint8Array(await file.arrayBuffer()));
    if (pages.length > 1) warn(`${file.name} has ${pages.length} pages; using the first. Separations as layers come later.`);
    return pages[0]!;
  }
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return imageFromRGBA(bmp.width, bmp.height, d.data);
}
