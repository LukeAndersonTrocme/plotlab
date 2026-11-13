import { zipSync, zlibSync } from "fflate";

/**
 * File encoders shared by the web worker and the CLI (pure; no canvas, no Node APIs).
 * Pixel layouts: "rgba" 4 bytes/px, "gray" 1 byte/px (0 = black), "bitmap" 1 byte/px
 * where nonzero = ink (written as black).
 */
export type PixelFormat = "rgba" | "rgb" | "gray" | "bitmap";

export interface Pixels {
  width: number;
  height: number;
  format: PixelFormat;
  data: Uint8Array | Uint8ClampedArray;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return crc;
}

const CHANNELS: Record<PixelFormat, number> = { rgba: 4, rgb: 3, gray: 1, bitmap: 1 };

/** Bitmap → packed 1-bit rows, MSB first. `inkBit` is the bit value written for ink. */
function packBits(p: Pixels, inkBit: 0 | 1): { rows: Uint8Array; stride: number } {
  const stride = Math.ceil(p.width / 8);
  const rows = new Uint8Array(stride * p.height);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const ink = p.data[y * p.width + x]! !== 0;
      if (ink === (inkBit === 1)) rows[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  return { rows, stride };
}

/** PNG with a pHYs chunk so print size survives. Bitmaps are written as 1-bit grayscale. */
export function encodePng(p: Pixels, dpi?: number): Uint8Array {
  const bitmap = p.format === "bitmap";
  const ch = CHANNELS[p.format];
  const stride = bitmap ? Math.ceil(p.width / 8) : p.width * ch;
  const raw = new Uint8Array((stride + 1) * p.height);
  if (bitmap) {
    // 1-bit gray: 0 = black. Ink is black.
    const { rows } = packBits(p, 0);
    for (let y = 0; y < p.height; y++) raw.set(rows.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  } else {
    for (let y = 0; y < p.height; y++) raw.set(p.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const chunks: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, (crc32(out.subarray(4, 8 + body.length)) ^ 0xffffffff) >>> 0);
    chunks.push(out);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, p.width);
  dv.setUint32(4, p.height);
  ihdr[8] = bitmap ? 1 : 8;
  ihdr[9] = { rgba: 6, rgb: 2, gray: 0, bitmap: 0 }[p.format];
  chunk("IHDR", ihdr);
  if (dpi) {
    const phys = new Uint8Array(9);
    const ppm = Math.round(dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1;
    chunk("pHYs", phys);
  }
  chunk("IDAT", zlibSync(raw, { level: 6 }));
  chunk("IEND", new Uint8Array(0));
  return concat(chunks);
}

/**
 * Baseline little-endian TIFF, one deflate-compressed strip, with resolution tags.
 * Bitmaps are 1-bit with ink = black (WhiteIsZero), as print shops expect for film.
 */
export function encodeTiff(p: Pixels, dpi: number): Uint8Array {
  const bitmap = p.format === "bitmap";
  const ch = CHANNELS[p.format];
  let body: Uint8Array;
  if (bitmap) body = packBits(p, 1).rows;
  else body = p.data instanceof Uint8Array ? p.data : new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  const strip = zlibSync(body, { level: 6 });
  const tags: Array<[number, number, number, number | number[]]> = []; // tag, type, count, value(s)
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  tags.push([256, LONG, 1, p.width]);
  tags.push([257, LONG, 1, p.height]);
  tags.push([258, SHORT, ch, Array(ch).fill(bitmap ? 1 : 8)]);
  tags.push([259, SHORT, 1, 8]); // Adobe deflate
  tags.push([262, SHORT, 1, bitmap ? 0 : ch >= 3 ? 2 : 1]); // WhiteIsZero / RGB / BlackIsZero
  tags.push([273, LONG, 1, 0]); // strip offset, patched below
  tags.push([277, SHORT, 1, ch]);
  tags.push([278, LONG, 1, p.height]);
  tags.push([279, LONG, 1, strip.length]);
  tags.push([282, RATIONAL, 1, [Math.round(dpi * 100), 100]]);
  tags.push([283, RATIONAL, 1, [Math.round(dpi * 100), 100]]);
  tags.push([284, SHORT, 1, 1]);
  tags.push([296, SHORT, 1, 2]); // inches
  if (p.format === "rgba") tags.push([338, SHORT, 1, 2]); // unassociated alpha

  const ifdSize = 2 + tags.length * 12 + 4;
  const ifdOffset = 8;
  let extra = ifdOffset + ifdSize; // where out-of-line values go
  const extraParts: Array<{ offset: number; bytes: Uint8Array }> = [];
  const ifd = new Uint8Array(ifdSize);
  const dv = new DataView(ifd.buffer);
  dv.setUint16(0, tags.length, true);
  let stripOffsetPos = 0;
  tags.forEach(([tag, type, count, v], i) => {
    const o = 2 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, count, true);
    const vals = Array.isArray(v) ? v : [v];
    const size = type === SHORT ? 2 : type === LONG ? 4 : 8;
    if (size * count <= 4) {
      vals.forEach((x, j) => (type === SHORT ? dv.setUint16(o + 8 + j * 2, x, true) : dv.setUint32(o + 8, x, true)));
      if (tag === 273) stripOffsetPos = o + 8;
    } else {
      const bytes = new Uint8Array(size * count);
      const bv = new DataView(bytes.buffer);
      if (type === RATIONAL) {
        bv.setUint32(0, vals[0]!, true);
        bv.setUint32(4, vals[1]!, true);
      } else vals.forEach((x, j) => bv.setUint16(j * 2, x, true));
      dv.setUint32(o + 8, extra, true);
      extraParts.push({ offset: extra, bytes });
      extra += bytes.length + (bytes.length & 1);
    }
  });
  dv.setUint32(stripOffsetPos, extra, true);
  const out = new Uint8Array(extra + strip.length);
  out.set([0x49, 0x49, 42, 0, ifdOffset, 0, 0, 0]);
  out.set(ifd, ifdOffset);
  for (const e of extraParts) out.set(e.bytes, e.offset);
  out.set(strip, extra);
  return out;
}

export function zipFiles(files: Array<{ name: string; data: Uint8Array | string }>): Uint8Array {
  const enc = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = typeof f.data === "string" ? enc.encode(f.data) : f.data;
  return zipSync(entries, { level: 6 });
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!);
  }
  if (i < bytes.length) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8);
    out.push(B64[n >> 18]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=") + "=");
  }
  return out.join("");
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
