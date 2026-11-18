/**
 * A tiny multi-page TIFF writer for fixtures and tests: uncompressed, little-endian,
 * 16-bit gray (BlackIsZero), one strip per page, with an optional PageName tag.
 * The engine only reads multi-page TIFFs; nothing in the app writes them.
 */
export interface GrayPage {
  width: number;
  height: number;
  /** Row-major 16-bit gray, 0 = black. */
  data: Uint16Array;
  name?: string;
}

export function writeGrayTiff16(pages: GrayPage[]): Uint8Array {
  const SHORT = 3, LONG = 4, ASCII = 2;
  // Lay out: header, then per page [pixels, name bytes, IFD].
  const parts: Uint8Array[] = [];
  let offset = 8;
  const header = new Uint8Array(8);
  header.set([0x49, 0x49, 42, 0]);
  parts.push(header);
  const ifdOffsets: number[] = [];
  const nextPtrPos: number[] = [];
  for (const p of pages) {
    const pixels = new Uint8Array(p.data.length * 2);
    const pv = new DataView(pixels.buffer);
    p.data.forEach((v, i) => pv.setUint16(i * 2, v, true));
    const pixelOffset = offset;
    parts.push(pixels);
    offset += pixels.length;
    let nameOffset = 0, nameLen = 0;
    if (p.name !== undefined) {
      const bytes = new TextEncoder().encode(p.name + "\0");
      nameOffset = offset;
      nameLen = bytes.length;
      parts.push(bytes);
      offset += bytes.length;
    }
    if (offset % 2) {
      parts.push(new Uint8Array(1));
      offset += 1;
    }
    const tags: Array<[number, number, number, number]> = [
      [256, LONG, 1, p.width],
      [257, LONG, 1, p.height],
      [258, SHORT, 1, 16],
      [259, SHORT, 1, 1],
      [262, SHORT, 1, 1],
      [273, LONG, 1, pixelOffset],
      [277, SHORT, 1, 1],
      [278, LONG, 1, p.height],
      [279, LONG, 1, pixels.length],
    ];
    if (p.name !== undefined) tags.push([285, ASCII, nameLen, nameOffset]);
    tags.sort((a, b) => a[0] - b[0]);
    const ifd = new Uint8Array(2 + tags.length * 12 + 4);
    const dv = new DataView(ifd.buffer);
    dv.setUint16(0, tags.length, true);
    tags.forEach(([tag, type, count, v], i) => {
      const o = 2 + i * 12;
      dv.setUint16(o, tag, true);
      dv.setUint16(o + 2, type, true);
      dv.setUint32(o + 4, count, true);
      if (type === SHORT) dv.setUint16(o + 8, v, true);
      else if (type === ASCII && count <= 4) new TextEncoder().encode(p.name! + "\0").forEach((b, j) => dv.setUint8(o + 8 + j, b));
      else dv.setUint32(o + 8, v, true);
    });
    ifdOffsets.push(offset);
    nextPtrPos.push(offset + ifd.length - 4);
    parts.push(ifd);
    offset += ifd.length;
  }
  const out = new Uint8Array(offset);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  const dv = new DataView(out.buffer);
  dv.setUint32(4, ifdOffsets[0]!, true);
  for (let i = 0; i < pages.length - 1; i++) dv.setUint32(nextPtrPos[i]!, ifdOffsets[i + 1]!, true);
  return out;
}
