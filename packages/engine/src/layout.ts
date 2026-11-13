import type { Frame, Paper, Position } from "./types.ts";

/**
 * Placing the source on paper (ADR 0005). This happens once, before any step: the
 * source is cropped/scaled into a Frame on the paper and resampled to the working
 * resolution. Steps only ever see mm.
 */
export interface Layout {
  /** fit = whole image inside the margins; fill = cover the margin box, cropping the rest. */
  fit: "fit" | "fill";
  marginMm: number;
  /** Anchor 0..1 on each axis: where the image sits (fit) or which part is kept (fill). */
  position: [number, number];
}

export const DEFAULT_LAYOUT: Layout = { fit: "fit", marginMm: 15, position: [0.5, 0.5] };

/** Longest side of the working raster. Beyond this, memory and time blow up. */
export const MAX_WORKING_SIDE = 4096;

/** A rectangle of the source, in source pixels (may be fractional). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function placeOnPaper(
  src: { width: number; height: number },
  paper: Paper,
  layout: Layout,
): { frame: Frame; crop: Crop } {
  const m = layout.marginMm;
  const bw = Math.max(1, paper.widthMm - 2 * m);
  const bh = Math.max(1, paper.heightMm - 2 * m);
  const bx = (paper.widthMm - bw) / 2;
  const by = (paper.heightMm - bh) / 2;
  const [px, py] = layout.position;
  if (layout.fit === "fit") {
    const s = Math.min(bw / src.width, bh / src.height);
    const fw = src.width * s, fh = src.height * s;
    return {
      frame: { xMm: bx + (bw - fw) * px, yMm: by + (bh - fh) * py, widthMm: fw, heightMm: fh },
      crop: { x: 0, y: 0, w: src.width, h: src.height },
    };
  }
  const s = Math.max(bw / src.width, bh / src.height);
  const cw = bw / s, ch = bh / s;
  return {
    frame: { xMm: bx, yMm: by, widthMm: bw, heightMm: bh },
    crop: { x: (src.width - cw) * px, y: (src.height - ch) * py, w: cw, h: ch },
  };
}

/**
 * Pixel size of the working raster for a frame. Never finer than the source (no
 * upsampling) and never longer than `maxSide`, with a warning when the cap bites.
 */
export function workingSize(
  frame: Frame,
  crop: Crop,
  mmPerPx: number,
  maxSide = MAX_WORKING_SIDE,
): { width: number; height: number; warnings: string[] } {
  const warnings: string[] = [];
  let eff = Math.max(mmPerPx, frame.widthMm / crop.w, frame.heightMm / crop.h);
  const long = Math.max(frame.widthMm, frame.heightMm) / eff;
  if (long > maxSide + 0.5) {
    eff = Math.max(frame.widthMm, frame.heightMm) / maxSide;
    warnings.push(
      `Working detail capped at ${maxSide} px on the long side (${eff.toFixed(3)} mm per pixel); ` +
        `the requested ${mmPerPx.toFixed(3)} mm would need ${Math.round(long)} px.`,
    );
  }
  return {
    width: Math.max(1, Math.round(frame.widthMm / eff)),
    height: Math.max(1, Math.round(frame.heightMm / eff)),
    warnings,
  };
}

/** Area-weighted resample of `crop` into width × height. The working raster is never finer than the source, so this only shrinks or copies. */
export function resample(
  img: { width: number; height: number; channels: number; data: Float32Array },
  crop: Crop,
  width: number,
  height: number,
): Float32Array {
  const c = img.channels;
  const out = new Float32Array(width * height * c);
  const weights = (start: number, span: number, n: number, limit: number) => {
    const res: Array<Array<[number, number]>> = [];
    for (let o = 0; o < n; o++) {
      const a = start + (o * span) / n, b = start + ((o + 1) * span) / n;
      const ws: Array<[number, number]> = [];
      for (let p = Math.floor(a); p < Math.ceil(b); p++) {
        const w = Math.min(b, p + 1) - Math.max(a, p);
        if (w > 1e-9) ws.push([Math.min(limit - 1, Math.max(0, p)), w]);
      }
      const total = ws.reduce((s, [, w]) => s + w, 0) || 1;
      res.push(ws.map(([p, w]) => [p, w / total]));
    }
    return res;
  };
  const wx = weights(crop.x, crop.w, width, img.width);
  const wy = weights(crop.y, crop.h, height, img.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < c; ch++) {
        let s = 0;
        for (const [sy, fy] of wy[y]!) for (const [sx, fx] of wx[x]!) s += (img.data[(sy * img.width + sx) * c + ch] ?? 0) * fy * fx;
        out[(y * width + x) * c + ch] = s;
      }
    }
  }
  return out;
}

/** Centre of pixel (px, py) of a width × height raster laid over `frame`, in paper mm. */
export function pxToMm(frame: Frame, width: number, height: number, px: number, py: number): Position {
  return [frame.xMm + ((px + 0.5) * frame.widthMm) / width, frame.yMm + ((py + 0.5) * frame.heightMm) / height];
}
