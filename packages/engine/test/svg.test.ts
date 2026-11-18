import { describe, expect, it } from "vitest";
import { parseSvg, parseXml, type GeoFeature, type Position } from "../src/index.ts";

const svg = (body: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"') =>
  `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** All features of a one-layer SVG. */
const features = (text: string, tol?: number): GeoFeature[] => parseSvg(text, tol === undefined ? {} : { toleranceMm: tol }).geometry.layers.flatMap((l) => l.features.features);
const coords = (f: GeoFeature | undefined): Position[] => (f!.geometry.type === "LineString" ? f!.geometry.coordinates : f!.geometry.coordinates[0]!);

function distToSegment(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const distToPolyline = (p: Position, line: Position[]) => Math.min(...line.slice(1).map((b, i) => distToSegment(p, line[i]!, b)));
const close = (a: Position[], b: Position[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(b[i]![0], 9);
    expect(p[1]).toBeCloseTo(b[i]![1], 9);
  });
};

describe("parseXml", () => {
  it("reads elements, attributes, entities, and skips comments, CDATA and the prolog", () => {
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY ns "http://x">]><!-- hi --><svg a='1' b="&lt;&amp;&#65;&#x42;&ns;"><style><![CDATA[ a < b ]]></style><g/></svg>`);
    expect(root.tag).toBe("svg");
    expect(root.attrs).toEqual({ a: "1", b: "<&ABhttp://x" });
    expect(root.children.map((c) => c.tag)).toEqual(["style", "g"]);
  });
  it("names the line of a malformed file", () => {
    expect(() => parseXml("<svg>\n<g>\n</svg>")).toThrow(/line 3/);
  });
});

describe("SVG units", () => {
  it("a 100 mm wide viewBox maps exactly", () => {
    const { geometry } = parseSvg(svg('<line x1="0" y1="0" x2="1000" y2="500"/>', 'width="100mm" height="50mm" viewBox="0 0 1000 500"'));
    expect([geometry.widthMm, geometry.heightMm]).toEqual([100, 50]);
    expect(coords(geometry.layers[0]!.features.features[0])).toEqual([[0, 0], [100, 50]]);
  });
  it("cm, in and px (96 dpi); unitless is px", () => {
    const dot = '<line x2="1"/>';
    expect(parseSvg(svg(dot, 'width="10cm" height="5cm"')).geometry.widthMm).toBeCloseTo(100, 9);
    expect(parseSvg(svg(dot, 'width="2in" height="1in"')).geometry.widthMm).toBeCloseTo(50.8, 9);
    expect(parseSvg(svg(dot, 'width="96px" height="48"')).geometry).toMatchObject({ widthMm: 25.4, heightMm: 12.7 });
    // No viewBox: user units are px.
    close(coords(features(svg('<line x1="0" y1="0" x2="96" y2="0"/>', 'width="10in" height="10in"'))[0]), [[0, 0], [25.4, 0]]);
  });
  it("a viewBox with no width/height is in px; a viewBox origin shifts everything", () => {
    const { geometry } = parseSvg(svg('<line x1="10" y1="10" x2="106" y2="10"/>', 'viewBox="10 10 96 96"'));
    expect(geometry.widthMm).toBeCloseTo(25.4, 9);
    close(coords(geometry.layers[0]!.features.features[0]), [[0, 0], [25.4, 0]]);
  });
  it("keeps the aspect ratio and centres (xMidYMid meet), or stretches with none", () => {
    const meet = features(svg('<line x1="0" y1="0" x2="200" y2="100"/>', 'width="100mm" height="100mm" viewBox="0 0 200 100"'));
    close(coords(meet[0]), [[0, 25], [100, 75]]);
    const none = features(svg('<line x1="0" y1="0" x2="200" y2="100"/>', 'width="100mm" height="100mm" viewBox="0 0 200 100" preserveAspectRatio="none"'));
    close(coords(none[0]), [[0, 0], [100, 100]]);
  });
});

describe("SVG elements", () => {
  it("line and polyline are open lines; polygon is closed", () => {
    const [l, pl, pg] = features(svg('<line x1="1" y1="2" x2="3" y2="4"/><polyline points="0,0 10,0 10,10"/><polygon points="0 0, 10 0 10 10"/>'));
    expect(l!.geometry.type).toBe("LineString");
    expect(pl!.geometry).toEqual({ type: "LineString", coordinates: [[0, 0], [10, 0], [10, 10]] });
    expect(pg!.geometry).toEqual({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10]]] });
  });
  it("rect is a closed ring at its corners", () => {
    expect(features(svg('<rect x="10" y="20" width="30" height="40"/>'))[0]!.geometry).toEqual({
      type: "Polygon",
      coordinates: [[[10, 20], [40, 20], [40, 60], [10, 60]]],
    });
  });
  it("rounded rect stays inside its box and touches each side", () => {
    const ring = coords(features(svg('<rect x="0" y="0" width="40" height="20" rx="5"/>'))[0]);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 40, 0, 20]);
    expect(ring.some((p) => p[0] === 0 && p[1] === 0)).toBe(false);
  });
  it("circle and ellipse are closed rings within tolerance of the true curve", () => {
    const tol = 0.01;
    const [c, e] = features(svg('<circle cx="50" cy="50" r="30"/><ellipse cx="50" cy="50" rx="40" ry="10"/>'), tol);
    const ring = coords(c);
    expect(c!.geometry.type).toBe("Polygon");
    for (const p of ring) expect(Math.abs(Math.hypot(p[0] - 50, p[1] - 50) - 30)).toBeLessThan(1e-9);
    // Sagitta check: the chord midpoints stay within tolerance of the circle.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      expect(30 - Math.hypot((a[0] + b[0]) / 2 - 50, (a[1] + b[1]) / 2 - 50)).toBeLessThanOrEqual(tol + 1e-9);
    }
    for (const p of coords(e)) expect(((p[0] - 50) / 40) ** 2 + ((p[1] - 50) / 10) ** 2).toBeCloseTo(1, 9);
  });
  it("skips hidden shapes, defs and zero-size shapes, and warns about text and images", () => {
    const { geometry, warnings } = parseSvg(
      svg('<defs><rect width="5" height="5"/></defs><rect width="5" height="5" display="none"/><g style="display:none"><line x2="5"/></g><circle r="0"/><text>hi</text><image href="x.png"/><line x2="5"/>'),
    );
    expect(geometry.layers.flatMap((l) => l.features.features)).toHaveLength(1);
    expect(warnings.join("\n")).toMatch(/text/);
    expect(warnings.join("\n")).toMatch(/image/);
  });
  it("an SVG with nothing to draw is an error", () => {
    expect(() => parseSvg(svg('<text>only words</text>'))).toThrow(/no lines or shapes/);
  });
  it("rejects a file that isn't SVG", () => {
    expect(() => parseSvg("<html></html>")).toThrow(/not an SVG/);
  });
});

describe("SVG paths", () => {
  it("M/L/H/V/Z absolute and relative, with implicit lineto", () => {
    const [abs, rel, implicit] = features(svg('<path d="M10 10 L30 10 V30 H10 Z"/><path d="m10,10 l20,0 v20 h-20 z"/><path d="M0 0 10 0 10 10"/>'));
    const square = [[10, 10], [30, 10], [30, 30], [10, 30]];
    expect(abs!.geometry).toEqual({ type: "Polygon", coordinates: [square] });
    expect(rel!.geometry).toEqual({ type: "Polygon", coordinates: [square] });
    expect(implicit!.geometry).toEqual({ type: "LineString", coordinates: [[0, 0], [10, 0], [10, 10]] });
  });
  it("relative moveto after closepath starts from the subpath start; closed subpaths of one path are rings of one polygon", () => {
    const fs = features(svg('<path d="M0 0 h40 v40 h-40 z m10 10 h20 v20 h-20 z M50 50 l10 0"/>'));
    expect(fs).toHaveLength(2);
    expect(fs[0]!.geometry.type).toBe("Polygon");
    expect((fs[0]!.geometry.coordinates as Position[][])[1]).toEqual([[10, 10], [30, 10], [30, 30], [10, 30]]);
    expect(fs[1]!.geometry).toEqual({ type: "LineString", coordinates: [[50, 50], [60, 50]] });
  });
  it("flattens cubic and quadratic curves within the tolerance, ending exactly on the endpoints", () => {
    const tol = 0.05;
    const [c, q, s] = features(svg('<path d="M0 0 C 0 80 100 80 100 0"/><path d="M0 50 q 50 -60 100 0"/><path d="M0 90 c10 -20 20 -20 30 0 s 20 20 30 0"/>'), tol);
    const cubic = (t: number): Position => {
      const u = 1 - t;
      return [3 * u * t * t * 100 + t ** 3 * 100, 3 * u * u * t * 80 + 3 * u * t * t * 80];
    };
    const quad = (t: number): Position => {
      const u = 1 - t;
      return [2 * u * t * 50 + t * t * 100, u * u * 50 + 2 * u * t * -10 + t * t * 50];
    };
    const cl = coords(c), ql = coords(q);
    expect(cl[0]).toEqual([0, 0]);
    expect(cl.at(-1)).toEqual([100, 0]);
    expect(ql.at(-1)).toEqual([100, 50]);
    for (let i = 0; i <= 200; i++) {
      expect(distToPolyline(cubic(i / 200), cl)).toBeLessThanOrEqual(tol);
      expect(distToPolyline(quad(i / 200), ql)).toBeLessThanOrEqual(tol);
    }
    // Every flattened vertex lies on the curve (no drift), and coarse tolerance means fewer points.
    expect(cl.length).toBeGreaterThan(features(svg('<path d="M0 0 C 0 80 100 80 100 0"/>'), 1).map(coords)[0]!.length);
    // S reflects the previous control point: the joint at x=30 is smooth, so the curve is symmetric.
    const sl = coords(s);
    expect(sl.at(-1)).toEqual([60, 90]);
    expect(Math.min(...sl.map((p) => p[1]))).toBeCloseTo(75, 0);
    expect(Math.max(...sl.map((p) => p[1]))).toBeCloseTo(105, 0);
  });
  it("arcs (A) follow the circle", () => {
    const ring = coords(features(svg('<path d="M20 50 A30 30 0 1 1 80 50 A30 30 0 1 1 20 50 Z"/>'), 0.01)[0]);
    for (const p of ring) expect(Math.abs(Math.hypot(p[0] - 50, p[1] - 50) - 30)).toBeLessThan(1e-6);
    // The top and bottom of the circle are reached to within the tolerance.
    expect(Math.min(...ring.map((p) => p[1])) - 20).toBeLessThanOrEqual(0.01);
    expect(80 - Math.max(...ring.map((p) => p[1]))).toBeLessThanOrEqual(0.01);
  });
  it("parses compact number syntax (signs and dots as separators, exponents, arc flags)", () => {
    const [p] = features(svg('<path d="M1-1L.5.5l1e1-2E0"/>'));
    close(coords(p), [[1, -1], [0.5, 0.5], [10.5, -1.5]]);
    const [a] = features(svg('<path d="M0 0a5 5 0 1110 0"/>'));
    expect(coords(a).at(-1)![0]).toBeCloseTo(10, 9);
  });
});

describe("SVG transforms and layers", () => {
  it("nested g transforms compose (translate, scale, matrix, rotate)", () => {
    const fs = features(
      svg(
        '<g transform="translate(10,20)"><g transform="scale(2)"><line x1="0" y1="0" x2="5" y2="0"/></g></g>' +
          '<g transform="matrix(1 0 0 1 5 5)"><line x1="0" y1="0" x2="1" y2="1" transform="scale(3 1)"/></g>' +
          '<line x1="0" y1="0" x2="10" y2="0" transform="rotate(90)"/>' +
          '<line x1="0" y1="0" x2="10" y2="0" transform="rotate(90 10 0)"/>',
      ),
    );
    close(coords(fs[0]), [[10, 20], [20, 20]]);
    close(coords(fs[1]), [[5, 5], [8, 6]]);
    close(coords(fs[2]), [[0, 0], [0, 10]]);
    close(coords(fs[3]), [[10, -10], [10, 0]]);
  });
  it("transforms apply before the viewBox→mm mapping", () => {
    const fs = features(svg('<g transform="translate(100 0)"><line x1="0" y1="0" x2="100" y2="0"/></g>', 'width="50mm" height="50mm" viewBox="0 0 200 200"'));
    close(coords(fs[0]), [[25, 0], [50, 0]]);
  });
  it("top-level groups become layers, named by inkscape:label or id; loose shapes get their own layer", () => {
    const { geometry } = parseSvg(
      svg(
        '<g id="layer1" inkscape:label="Red pen" inkscape:groupmode="layer"><line x2="5"/></g>' +
          '<g id="blue"><g><line x2="5"/><line x2="6"/></g></g>' +
          '<g id="empty"/>' +
          '<line x2="7"/>',
      ),
    );
    expect(geometry.layers.map((l) => [l.id, l.name, l.features.features.length])).toEqual([
      ["layer1", "Red pen", 1],
      ["blue", "blue", 2],
      ["svg", "Ungrouped", 1],
    ]);
  });
  it("with no named top-level groups everything is one layer", () => {
    const { geometry } = parseSvg(svg('<g><line x2="5"/></g><line x2="7"/>'));
    expect(geometry.layers.map((l) => [l.id, l.name, l.features.features.length])).toEqual([["svg", "SVG", 2]]);
  });
});
