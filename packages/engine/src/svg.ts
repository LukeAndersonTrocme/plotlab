import type { GeoFeature, GeometryLayer, Position, RawGeometry } from "./types.ts";

/**
 * SVG as a source: shapes become lines that enter the chain at the geometry stage.
 * Everything is mapped through viewBox + width/height into mm, curves are flattened to
 * polylines within a tolerance, and top-level named groups (Inkscape layers) become layers.
 *
 * One small XML reader serves the web app and the CLI, so both read a file the same way
 * (Node has no DOMParser, and the browser's isn't available in workers).
 */

/** Default curve flattening tolerance, in the SVG's own mm (before paper fit). */
export const SVG_TOLERANCE_MM = 0.02;

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const BASIC_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * A minimal XML reader for SVG: elements and attributes only. Text, comments, CDATA and
 * processing instructions are skipped; DOCTYPE entity declarations are honoured (old
 * Illustrator files use them for namespaces).
 */
export function parseXml(text: string): XmlNode {
  const entities: Record<string, string> = { ...BASIC_ENTITIES };
  const decode = (s: string) =>
    s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_][\w.-]*);/g, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return entities[e] ?? m;
    });
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  const fail = (i: number, what: string): never => {
    throw new Error(`this SVG isn't well-formed XML (line ${lineAt(i)}: ${what})`);
  };
  const skipTo = (i: number, end: string) => {
    const j = text.indexOf(end, i);
    if (j < 0) fail(i, `unclosed ${text.slice(i, i + 9)}…`);
    return j + end.length;
  };
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith("<?", i)) i = skipTo(i, "?>");
    else if (text.startsWith("<!--", i)) i = skipTo(i, "-->");
    else if (text.startsWith("<![CDATA[", i)) i = skipTo(i, "]]>");
    else if (text.startsWith("<!", i)) {
      // DOCTYPE, maybe with an internal subset in [...].
      const open = text.indexOf("[", i), close = text.indexOf(">", i);
      if (open >= 0 && open < close) {
        const end = text.indexOf("]", open);
        if (end < 0) fail(i, "unclosed DOCTYPE");
        for (const m of text.slice(open, end).matchAll(/<!ENTITY\s+([\w.-]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) entities[m[1]!] = m[2] ?? m[3] ?? "";
        i = skipTo(end, ">");
      } else i = skipTo(i, ">");
    } else if (text[i + 1] === "/") {
      const end = skipTo(i, ">");
      const name = text.slice(i + 2, end - 1).trim();
      const top = stack.pop();
      if (!top) fail(i, `</${name}> closes nothing`);
      if (top!.tag !== name) fail(i, `expected </${top!.tag}> but found </${name}>`);
      i = end;
    } else {
      const m = /^<([^\s/>]+)/.exec(text.slice(i, i + 256));
      if (!m) fail(i, "stray <");
      const node: XmlNode = { tag: m![1]!, attrs: {}, children: [] };
      let j = i + m![0].length;
      const attr = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attr.lastIndex = j;
        const a = attr.exec(text);
        if (!a) fail(j, `bad attribute in <${node.tag}>`);
        j = attr.lastIndex;
        if (a![4]) {
          if (stack.length) stack[stack.length - 1]!.children.push(node);
          else if (root) fail(i, "more than one root element");
          else root = node;
          if (a![4] === ">") stack.push(node);
          break;
        }
        node.attrs[a![1]!] = decode(a![2] ?? a![3] ?? "");
      }
      i = j;
    }
  }
  if (stack.length) fail(text.length, `<${stack[stack.length - 1]!.tag}> is never closed`);
  if (!root) throw new Error("this file has no XML elements in it");
  return root;
}

/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m ∘ n: apply n first, then m. */
function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const apply = (m: Matrix, x: number, y: number): Position => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Largest stretch the matrix applies to any direction (its largest singular value). */
function maxScale(m: Matrix): number {
  const [a, b, c, d] = m;
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const NUMBER_AT = new RegExp(NUMBER.source, "y");
const numbers = (s: string | undefined): number[] => (s?.match(NUMBER) ?? []).map(Number);

function parseTransform(s: string | undefined): Matrix {
  let m = IDENTITY;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = numbers(args);
    const rad = ((v[0] ?? 0) * Math.PI) / 180;
    let t: Matrix = IDENTITY;
    if (fn === "matrix" && v.length >= 6) t = v.slice(0, 6) as Matrix;
    else if (fn === "translate") t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (fn === "scale") t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r: Matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
      const cx = v[1] ?? 0, cy = v[2] ?? 0;
      t = mul(mul([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === "skewX") t = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan(rad), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

const UNIT_MM: Record<string, number> = { "": 25.4 / 96, px: 25.4 / 96, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

/** A length attribute in mm, or null when absent or relative (%, em). */
function lengthMm(s: string | undefined): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(s ?? "");
  const unit = UNIT_MM[m?.[2]?.toLowerCase() ?? "%"];
  return m && unit !== undefined ? Number(m[1]) * unit : null;
}

/** A polyline in mm; closed ones become polygon rings. */
interface Subpath {
  pts: Position[];
  closed: boolean;
}

/** Collects one shape's subpaths in mm, flattening curves within `tol` mm. */
class PathBuilder {
  subpaths: Subpath[] = [];
  private cur: Subpath | null = null;
  constructor(
    private m: Matrix,
    private tol: number,
  ) {}
  move(x: number, y: number): void {
    this.cur = { pts: [apply(this.m, x, y)], closed: false };
    this.subpaths.push(this.cur);
  }
  /** Start a subpath at (x, y) unless one is open (drawing after Z starts from the subpath start). */
  ensure(x: number, y: number): void {
    if (!this.cur) this.move(x, y);
  }
  line(x: number, y: number): void {
    this.cur!.pts.push(apply(this.m, x, y));
  }
  close(): void {
    if (this.cur) this.cur.closed = true;
    this.cur = null;
  }
  /** Bézier through user-space control points; flattened after the transform (affine maps keep Béziers Béziers). */
  curve(ctrl: Array<[number, number]>): void {
    const p = ctrl.map(([x, y]) => apply(this.m, x, y));
    const second = (i: number) => Math.hypot(p[i]![0] - 2 * p[i + 1]![0] + p[i + 2]![0], p[i]![1] - 2 * p[i + 1]![1] + p[i + 2]![1]);
    // Chord error ≤ max|B''| / (8 n²): cubic |B''| ≤ 6·max second difference, quadratic 2·it.
    const n =
      p.length === 4
        ? Math.ceil(Math.sqrt((3 * Math.max(second(0), second(1))) / (4 * this.tol)))
        : Math.ceil(Math.sqrt(second(0) / (4 * this.tol)));
    const out = this.cur!.pts;
    for (let i = 1; i < n; i++) {
      const t = i / n, u = 1 - t;
      const w = p.length === 4 ? [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] : [u * u, 2 * u * t, t * t];
      out.push([w.reduce((s, wi, k) => s + wi * p[k]![0], 0), w.reduce((s, wi, k) => s + wi * p[k]![1], 0)]);
    }
    out.push(p[p.length - 1]!);
  }
  /** Elliptical arc around (cx, cy) from angle t0 by dt (radians), x-axis rotated by phi. Ends exactly at `end` if given. */
  arc(cx: number, cy: number, rx: number, ry: number, phi: number, t0: number, dt: number, end?: [number, number]): void {
    const r = Math.max(rx, ry) * maxScale(this.m);
    const step = r > this.tol ? 2 * Math.acos(1 - this.tol / r) : Math.PI / 2;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / Math.min(step, Math.PI / 2)));
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const at = (t: number): [number, number] => [cx + rx * cp * Math.cos(t) - ry * sp * Math.sin(t), cy + rx * sp * Math.cos(t) + ry * cp * Math.sin(t)];
    this.ensure(...at(t0));
    for (let i = 1; i <= n; i++) this.line(...(i === n && end ? end : at(t0 + (dt * i) / n)));
  }
  /** SVG endpoint arc (implementation notes F.6.5). */
  endpointArc(x1: number, y1: number, rx: number, ry: number, deg: number, large: boolean, sweep: boolean, x2: number, y2: number): void {
    if (x1 === x2 && y1 === y2) return;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return this.line(x2, y2);
    const phi = (deg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy;
    const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t0 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    this.arc(cx, cy, rx, ry, phi, t0, dt, [x2, y2]);
  }
}

/** Run an SVG path `d` string into a builder. Supports every command (M L H V C S Q T A Z, absolute and relative). */
function tracePath(d: string, b: PathBuilder): void {
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  const num = (): number | null => {
    skip();
    NUMBER_AT.lastIndex = i;
    const m = NUMBER_AT.exec(d);
    if (!m) return null;
    i = NUMBER_AT.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean | null => {
    skip();
    const c = d[i];
    if (c !== "0" && c !== "1") return null;
    i++;
    return c === "1";
  };
  let x = 0, y = 0, sx = 0, sy = 0;
  // Last control point, for S/T reflection.
  let lastC: [number, number] | null = null, lastQ: [number, number] | null = null;
  let cmd = "";
  while (true) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i]!)) cmd = d[i++]!;
    else if (!cmd) return; // garbage before the first command: stop, as browsers do
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C === "Z") {
      b.close();
      x = sx;
      y = sy;
      lastC = lastQ = null;
      cmd = "";
      continue;
    }
    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[C];
    if (!arity) return;
    const v: number[] = [];
    for (let k = 0; k < arity; k++) {
      const n = C === "A" && (k === 3 || k === 4) ? flag() : num();
      if (n === null) return; // malformed: keep what was drawn so far
      v.push(Number(n));
    }
    if (C !== "M") b.ensure(x, y);
    let nextC: [number, number] | null = null, nextQ: [number, number] | null = null;
    if (C === "M") {
      x = ox + v[0]!;
      y = oy + v[1]!;
      sx = x;
      sy = y;
      b.move(x, y);
      cmd = rel ? "l" : "L"; // further pairs are implicit lineto
    } else if (C === "L" || C === "H" || C === "V") {
      if (C === "H") x = ox + v[0]!;
      else if (C === "V") y = oy + v[0]!;
      else [x, y] = [ox + v[0]!, oy + v[1]!];
      b.line(x, y);
    } else if (C === "C" || C === "S") {
      const c1: [number, number] = C === "C" ? [ox + v[0]!, oy + v[1]!] : lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const r = C === "C" ? v.slice(2) : v;
      const c2: [number, number] = [ox + r[0]!, oy + r[1]!];
      const e: [number, number] = [ox + r[2]!, oy + r[3]!];
      b.curve([[x, y], c1, c2, e]);
      nextC = c2;
      [x, y] = e;
    } else if (C === "Q" || C === "T") {
      const c: [number, number] = C === "Q" ? [ox + v[0]!, oy + v[1]!] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
      const r = C === "Q" ? v.slice(2) : v;
      const e: [number, number] = [ox + r[0]!, oy + r[1]!];
      b.curve([[x, y], c, e]);
      nextQ = c;
      [x, y] = e;
    } else if (C === "A") {
      const e: [number, number] = [ox + v[5]!, oy + v[6]!];
      b.endpointArc(x, y, v[0]!, v[1]!, v[2]!, v[3] === 1, v[4] === 1, e[0], e[1]);
      [x, y] = e;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
}

const SILENT = new Set(["defs", "symbol", "clipPath", "mask", "marker", "pattern", "style", "script", "title", "desc", "metadata", "linearGradient", "radialGradient", "filter", "namedview"]);
const CONTAINERS = new Set(["g", "a", "switch", "svg"]);
const UNSUPPORTED: Record<string, string> = {
  text: "text isn't read yet; convert it to paths first (Inkscape: Path → Object to Path)",
  image: "embedded images aren't read from SVG; open the image file itself instead",
  use: "clones (<use>) aren't read yet; unlink them first (Inkscape: Edit → Clone → Unlink Clone)",
  foreignObject: "foreignObject content isn't read",
};

const local = (tag: string) => (tag.startsWith("svg:") ? tag.slice(4) : tag.startsWith("sodipodi:") ? tag.slice(9) : tag);
const hidden = (n: XmlNode) => n.attrs.display === "none" || /(^|;)\s*display\s*:\s*none/.test(n.attrs.style ?? "");
const coord = (n: XmlNode, a: string) => {
  const v = lengthMm(n.attrs[a]);
  // Shape coordinates are user units; a bare number is the common case. Units on them are rare: treat as px.
  return v === null ? 0 : v / UNIT_MM.px!;
};

function shapeToFeatures(n: XmlNode, tag: string, m: Matrix, tol: number): GeoFeature[] {
  const b = new PathBuilder(m, tol);
  if (tag === "path") tracePath(n.attrs.d ?? "", b);
  else if (tag === "line") {
    b.move(coord(n, "x1"), coord(n, "y1"));
    b.line(coord(n, "x2"), coord(n, "y2"));
  } else if (tag === "polyline" || tag === "polygon") {
    const v = numbers(n.attrs.points);
    for (let k = 0; k + 1 < v.length; k += 2) (k === 0 ? b.move(v[k]!, v[k + 1]!) : b.line(v[k]!, v[k + 1]!));
    if (tag === "polygon") b.close();
  } else if (tag === "rect") {
    const x = coord(n, "x"), y = coord(n, "y"), w = coord(n, "width"), h = coord(n, "height");
    if (w <= 0 || h <= 0) return [];
    let rx = lengthMm(n.attrs.rx) !== null ? coord(n, "rx") : null;
    let ry = lengthMm(n.attrs.ry) !== null ? coord(n, "ry") : null;
    rx = Math.min(w / 2, Math.max(0, rx ?? ry ?? 0));
    ry = Math.min(h / 2, Math.max(0, ry ?? rx));
    if (rx === 0 || ry === 0) tracePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`, b);
    else {
      const a = (ex: number, ey: number) => `A${rx} ${ry} 0 0 1 ${ex} ${ey}`;
      tracePath(`M${x + rx} ${y}H${x + w - rx}${a(x + w, y + ry)}V${y + h - ry}${a(x + w - rx, y + h)}H${x + rx}${a(x, y + h - ry)}V${y + ry}${a(x + rx, y)}Z`, b);
    }
  } else if (tag === "circle" || tag === "ellipse") {
    const rx = tag === "circle" ? coord(n, "r") : coord(n, "rx");
    const ry = tag === "circle" ? rx : coord(n, "ry");
    if (rx <= 0 || ry <= 0) return [];
    const cx = coord(n, "cx"), cy = coord(n, "cy");
    b.move(cx + rx, cy);
    b.arc(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    b.subpaths[0]!.pts.pop(); // the ring closes itself
    b.close();
  } else return [];

  const props = { element: tag, ...(n.attrs.id ? { id: n.attrs.id } : {}) };
  const rings: Position[][] = [];
  const out: GeoFeature[] = [];
  for (const s of b.subpaths) {
    const pts = s.pts;
    if (s.closed && pts.length > 1 && pts[0]![0] === pts.at(-1)![0] && pts[0]![1] === pts.at(-1)![1]) pts.pop();
    if (pts.length < 2) continue;
    if (s.closed && pts.length >= 3) rings.push(pts);
    else out.push({ type: "Feature", geometry: { type: "LineString", coordinates: s.closed ? [...pts, pts[0]!] : pts }, properties: { ...props } });
  }
  if (rings.length) out.unshift({ type: "Feature", geometry: { type: "Polygon", coordinates: rings }, properties: props });
  return out;
}

/** Where the viewBox lands in mm (preserveAspectRatio), as a matrix from user units. */
function viewportMatrix(vb: number[] | null, wMm: number, hMm: number, par: string | undefined): Matrix {
  if (!vb) return [UNIT_MM.px!, 0, 0, UNIT_MM.px!, 0, 0];
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const [align = "xMidYMid", mode = "meet"] = (par ?? "").trim().split(/\s+/).filter((s) => s !== "defer");
  if (align === "none") return [wMm / vw, 0, 0, hMm / vh, -vx * (wMm / vw), -vy * (hMm / vh)];
  const s = mode === "slice" ? Math.max(wMm / vw, hMm / vh) : Math.min(wMm / vw, hMm / vh);
  const frac = (k: string) => (k === "Min" ? 0 : k === "Max" ? 1 : 0.5);
  const ax = frac(align.slice(1, 4)), ay = frac(align.slice(5, 8));
  return [s, 0, 0, s, -vx * s + (wMm - vw * s) * ax, -vy * s + (hMm - vh * s) * ay];
}

export interface SvgOptions {
  /** Max distance between a curve and its flattened polyline, mm. */
  toleranceMm?: number;
}

/** Parse an SVG document into lines in mm, grouped into layers. Throws on files with nothing to draw. */
export function parseSvg(text: string, opts: SvgOptions = {}): { geometry: RawGeometry; warnings: string[] } {
  const tol = opts.toleranceMm ?? SVG_TOLERANCE_MM;
  const root = parseXml(text);
  if (local(root.tag) !== "svg") throw new Error(`this file is not an SVG (its root element is <${root.tag}>)`);
  const vbRaw = numbers(root.attrs.viewBox);
  const vb = vbRaw.length === 4 && vbRaw[2]! > 0 && vbRaw[3]! > 0 ? vbRaw : null;
  let wMm = lengthMm(root.attrs.width), hMm = lengthMm(root.attrs.height);
  if (vb) {
    if (wMm === null && hMm === null) [wMm, hMm] = [vb[2]! * UNIT_MM.px!, vb[3]! * UNIT_MM.px!];
    else if (wMm === null) wMm = (hMm! * vb[2]!) / vb[3]!;
    else if (hMm === null) hMm = (wMm * vb[3]!) / vb[2]!;
  }
  const base = mul(viewportMatrix(vb, wMm ?? 0, hMm ?? 0, root.attrs.preserveAspectRatio), parseTransform(root.attrs.transform));

  const skipped = new Map<string, number>();
  const walk = (n: XmlNode, m: Matrix, out: GeoFeature[]) => {
    const tag = local(n.tag);
    if (hidden(n) || SILENT.has(tag)) return;
    if (UNSUPPORTED[tag]) {
      skipped.set(tag, (skipped.get(tag) ?? 0) + 1);
      return;
    }
    const mm = mul(m, parseTransform(n.attrs.transform));
    if (CONTAINERS.has(tag)) for (const c of n.children) walk(c, mm, out);
    else out.push(...shapeToFeatures(n, tag, mm, tol));
  };

  const named = (n: XmlNode) => local(n.tag) === "g" && !hidden(n) && Boolean(n.attrs.id || n.attrs["inkscape:label"]);
  const grouped = root.children.some(named);
  const layers: GeometryLayer[] = [];
  const used = new Set<string>();
  const addLayer = (id: string, name: string, features: GeoFeature[]) => {
    if (!features.length) return;
    let unique = id;
    for (let k = 2; used.has(unique); k++) unique = `${id}-${k}`;
    used.add(unique);
    layers.push({ id: unique, name, features: { type: "FeatureCollection", features } });
  };
  const loose: GeoFeature[] = [];
  for (const c of root.children) {
    if (grouped && named(c)) {
      const fs: GeoFeature[] = [];
      walk(c, base, fs);
      const label = c.attrs["inkscape:label"];
      const id = c.attrs.id || label!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layer";
      addLayer(id, label || c.attrs.id!, fs);
    } else walk(c, base, loose);
  }
  addLayer("svg", grouped ? "Ungrouped" : "SVG", loose);

  const warnings = [...skipped].map(([tag, k]) => `Skipped ${k} <${tag}> element${k === 1 ? "" : "s"}: ${UNSUPPORTED[tag]}.`);
  if (!layers.length) throw new Error(`this SVG has no lines or shapes to draw${warnings.length ? ` (${warnings.join(" ")})` : ""}`);
  if (wMm === null || hMm === null) {
    // No size and no viewBox: the drawing's own extent, from the origin.
    let mx = 0, my = 0;
    for (const l of layers) for (const f of l.features.features) for (const r of f.geometry.type === "Polygon" ? f.geometry.coordinates : [f.geometry.coordinates]) for (const p of r) [mx, my] = [Math.max(mx, p[0]), Math.max(my, p[1])];
    wMm ??= mx || 1;
    hMm ??= my || 1;
  }
  return { geometry: { kind: "geometry", widthMm: wMm, heightMm: hMm, layers }, warnings };
}
