import { describe, expect, it } from "vitest";
import { writeGrayTiff16, type GrayPage } from "../../../golden/fixtures/tiff-pages.ts";
import { decodeTiffLayers, decodeTiffSource, encodeTiff, sourceStage } from "../src/index.ts";

const page = (width: number, height: number, f: (i: number) => number, name?: string): GrayPage => ({
  width,
  height,
  data: Uint16Array.from({ length: width * height }, (_, i) => f(i)),
  ...(name !== undefined ? { name } : {}),
});

describe("multi-page TIFF as separations", () => {
  it("returns one tone layer per page, on one grid, keeping 16-bit precision", () => {
    const bytes = writeGrayTiff16([page(4, 3, () => 65535), page(4, 3, (i) => i * 1000), page(4, 3, () => 1)]);
    const ls = decodeTiffLayers(bytes);
    expect(ls.kind).toBe("layers");
    expect([ls.width, ls.height]).toEqual([4, 3]);
    expect(ls.layers.map((l) => l.id)).toEqual(["page-1", "page-2", "page-3"]);
    expect(ls.layers.map((l) => l.name)).toEqual(["Page 1", "Page 2", "Page 3"]);
    for (const l of ls.layers) {
      expect(l.values.kind).toBe("tone");
      expect(l.values.data).toHaveLength(12);
    }
    // Tone is ink density: white paper (65535) is no ink, black is full ink.
    expect(ls.layers[0]!.values.data[0]).toBe(0);
    expect(ls.layers[1]!.values.data[5]).toBeCloseTo(1 - 5000 / 65535, 6);
    // 1/65535 is far below one 8-bit step: it must survive.
    expect(ls.layers[2]!.values.data[0]).toBeCloseTo(1 - 1 / 65535, 7);
    expect(ls.layers[2]!.values.data[0]).toBeLessThan(1);
  });

  it("names layers after TIFF page names when present", () => {
    const bytes = writeGrayTiff16([page(2, 2, () => 0, "Cyan"), page(2, 2, () => 0, "Spot Gold"), page(2, 2, () => 0, "Cyan")]);
    const ls = decodeTiffLayers(bytes);
    expect(ls.layers.map((l) => l.name)).toEqual(["Cyan", "Spot Gold", "Cyan"]);
    expect(ls.layers.map((l) => l.id)).toEqual(["cyan", "spot-gold", "cyan-3"]);
  });

  it("refuses pages of different sizes with a plain message", () => {
    const bytes = writeGrayTiff16([page(4, 3, () => 0), page(4, 3, () => 0), page(5, 3, () => 0)]);
    expect(() => decodeTiffLayers(bytes)).toThrow(/page 3 is 5 × 3 px.*page 1 is 4 × 3 px/);
  });

  it("a single-page TIFF still enters as an image; several pages enter as layers", () => {
    const one = decodeTiffSource(encodeTiff({ width: 2, height: 1, format: "gray", data: new Uint8Array([0, 255]) }, 300));
    expect(sourceStage(one)).toBe("image");
    const three = decodeTiffSource(writeGrayTiff16([page(2, 2, () => 0), page(2, 2, () => 0), page(2, 2, () => 0)]));
    expect(sourceStage(three)).toBe("layers");
  });
});
