import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Paper } from "@plotlab/engine";
import { addBox, applyBox, applyLens, bandView, boxRect, fitLens, moveBox, moveLens, removeBox, resizeBox, resizeLens, type Band, type Box, type Compare, type Rect } from "./compare.ts";
import type { InspectTarget, InspectView } from "./protocol.ts";
import { StageLayers } from "./StageView.tsx";

const hits = (b: Rect, p: { x: number; y: number }, ex: number, ey: number) => p.x >= b.x && p.x <= b.x + b.w + ex && p.y >= b.y && p.y <= b.y + b.h + ey;

/** A drag in progress: the comparison as drawn meanwhile, handed up once on release. */
type Drag =
  | { t: "lens"; dx: number; dy: number; c: Compare }
  | { t: "move"; k: number; before: Box; dx: number; dy: number; c: Compare }
  | { t: "resize"; k: number; before: Box; dx: number; dy: number; c: Compare }
  | { t: "new"; x0: number; y0: number; rect: Rect };

export type OverlayProps = {
  paper: Paper;
  compare: Compare;
  /** What the worker was asked for (`compareTargets`), to match `views` against. */
  targets: InspectTarget[];
  views: Array<InspectView | null> | null;
  labelOf: (band: Band) => string;
  hidden: Set<string>;
  showTravel: boolean;
  busy: boolean;
  /** The step being looked at: what a newly drawn box shows. */
  looking: Band;
  onChange: (c: Compare) => void;
};

/**
 * Compare stages, the lens and boxes layouts (#76): one step across the whole image, and over
 * it a circle (the lens) or rectangles (boxes) showing other steps. Drag the lens anywhere;
 * the scroll wheel resizes it while the pointer is over it. Drag on the image to draw a box
 * (a click makes a default-sized one); drag a box to move it, its corner to resize it. As with
 * the dividers, a drag is drawn here and handed up once, on release.
 */
export function LensBoxesCanvas(props: OverlayProps) {
  const { widthMm: w, heightMm: h } = props.paper;
  const aspect = w / h;
  const side = Math.min(w, h);
  const fs = side * 0.035;
  const svg = useRef<SVGSVGElement>(null);
  const lensEl = useRef<SVGCircleElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [drag, setDrag] = useState<Drag | null>(null);
  const c = drag && drag.t !== "new" ? drag.c : props.compare;
  const lensLayout = c.layout === "lens";
  const under = c.bands[0] ?? "source";
  const inLens = c.bands[1] ?? under;
  const L = fitLens(c.lens, aspect);
  const corner = side * 0.045;

  // The scroll wheel resizes the lens, only while the pointer is over it (the page scrolls elsewhere).
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = lensEl.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = latest.current;
      p.onChange(resizeLens(p.compare, fitLens(p.compare.lens, aspect).r * Math.exp(-e.deltaY * 0.0015), aspect));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [lensLayout, aspect]);

  const point = (e: PointerEvent) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / w, y: p.y / h };
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    const p = point(e);
    if (!p || e.button > 0) return;
    const now = props.compare;
    let d: Drag | null = null;
    if (lensLayout) {
      // Inside the lens it's carried from where it was grabbed; elsewhere it jumps to the pointer.
      const l = fitLens(now.lens, aspect);
      const inside = Math.hypot((p.x - l.x) * w, (p.y - l.y) * h) <= l.r * side;
      d = { t: "lens", dx: inside ? p.x - l.x : 0, dy: inside ? p.y - l.y : 0, c: inside ? now : moveLens(now, p.x, p.y, aspect) };
    } else {
      const cx = corner / w;
      const cy = corner / h;
      // The topmost box under the pointer (the last drawn), its corner reaching a little outside.
      let k = now.boxes.length - 1;
      while (k >= 0 && !hits(now.boxes[k]!, p, cx * 0.3, cy * 0.3)) k--;
      const b = now.boxes[k];
      if (b && p.x >= b.x + b.w - cx && p.y >= b.y + b.h - cy) d = { t: "resize", k, before: b, dx: b.x + b.w - p.x, dy: b.y + b.h - p.y, c: now };
      else if (b) d = { t: "move", k, before: b, dx: p.x - b.x, dy: p.y - b.y, c: now };
      else if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) d = { t: "new", x0: p.x, y0: p.y, rect: boxRect(p.x, p.y, p.x, p.y) };
    }
    if (!d) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(d);
  };

  const move = (e: PointerEvent) => {
    const p = drag && point(e);
    if (!drag || !p) return;
    if (drag.t === "lens") setDrag({ ...drag, c: moveLens(drag.c, p.x - drag.dx, p.y - drag.dy, aspect) });
    else if (drag.t === "move") setDrag({ ...drag, c: moveBox(drag.c, drag.k, p.x - drag.dx, p.y - drag.dy) });
    else if (drag.t === "resize") setDrag({ ...drag, c: resizeBox(drag.c, drag.k, p.x + drag.dx, p.y + drag.dy) });
    else setDrag({ ...drag, rect: boxRect(drag.x0, drag.y0, p.x, p.y) });
  };

  const release = () => {
    // Only what the drag changed goes on the comparison as it is now: a step removed meanwhile stays removed.
    if (drag?.t === "lens") props.onChange(applyLens(props.compare, drag.c.lens));
    else if (drag?.t === "move" || drag?.t === "resize") props.onChange(applyBox(props.compare, drag.before, drag.c.boxes[drag.k] ?? drag.before));
    else if (drag?.t === "new") props.onChange(addBox(props.compare, drag.rect, props.looking));
    setDrag(null);
  };

  const lensKey = (e: KeyboardEvent) => {
    const now = props.compare;
    const l = fitLens(now.lens, aspect);
    const dx = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key] ?? 0;
    const dy = { ArrowUp: -0.02, ArrowDown: 0.02 }[e.key] ?? 0;
    const grow = { "+": 1.1, "=": 1.1, "-": 1 / 1.1 }[e.key];
    if (!dx && !dy && !grow) return;
    e.preventDefault();
    props.onChange(grow ? resizeLens(now, l.r * grow, aspect) : moveLens(now, l.x + dx, l.y + dy, aspect));
  };
  const boxKey = (k: number, e: KeyboardEvent) => {
    const b = props.compare.boxes[k];
    if (!b) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return props.onChange(removeBox(props.compare, k));
    }
    const dx = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key] ?? 0;
    const dy = { ArrowUp: -0.02, ArrowDown: 0.02 }[e.key] ?? 0;
    if (!dx && !dy) return;
    e.preventDefault();
    props.onChange(moveBox(props.compare, k, b.x + dx, b.y + dy));
  };

  /** One step's picture over the whole paper, or nothing while its reply is missing. */
  const layers = (band: Band) => {
    const v = bandView(props.views, c, props.targets, band);
    return v ? <StageLayers rasters={v.rasters} plot={v.plot} showTravel={props.showTravel && v.kind === "plot"} underlay={null} hidden={props.hidden} /> : null;
  };
  const pill = (text: string, x: number, y: number, key: string, centre = false): ReactNode => {
    if (!text) return null; // a removed step, until the view catches up
    const tw = text.length * fs * 0.58 + fs;
    const left = Math.max(0, Math.min(w - tw, centre ? x - tw / 2 : x));
    const top = Math.max(0, Math.min(h - fs * 1.6, y));
    return (
      <g key={key} className="cmp-label" aria-hidden="true">
        <rect x={left} y={top} width={tw} height={fs * 1.6} rx={fs * 0.8} />
        <text x={left + tw / 2} y={top + fs * 1.15} textAnchor="middle" fontSize={fs}>
          {text}
        </text>
      </g>
    );
  };
  const boxes = drag?.t === "new" ? [...c.boxes, { ...drag.rect, step: props.looking }] : c.boxes;
  const underView = bandView(props.views, c, props.targets, under);

  return (
    <svg
      ref={svg}
      className={`preview compare-canvas ${c.layout}`}
      viewBox={`-5 -5 ${w + 10} ${h + 10}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Compare stages"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={() => setDrag(null)}
    >
      <defs>
        <clipPath id={`${id}-lens`}>
          <circle cx={L.x * w} cy={L.y * h} r={L.r * side} />
        </clipPath>
        {boxes.map((b, k) => (
          <clipPath key={k} id={`${id}-b${k}`}>
            <rect x={b.x * w} y={b.y * h} width={b.w * w} height={b.h * h} />
          </clipPath>
        ))}
      </defs>
      <rect x={0} y={0} width={w} height={h} className="paper" />
      <g className="cmp-under" data-band={under}>
        {layers(under)}
      </g>
      {!underView && (
        <text x={w / 2} y={h / 2} textAnchor="middle" className="empty-text" fontSize={fs}>
          {props.busy ? "Working…" : "Nothing here"}
        </text>
      )}
      {lensLayout ? (
        <>
          <g className="cmp-lens" data-band={inLens} clipPath={`url(#${id}-lens)`}>
            <rect x={0} y={0} width={w} height={h} className="paper" />
            {layers(inLens)}
          </g>
          <circle
            ref={lensEl}
            className="cmp-lens-ring"
            cx={L.x * w}
            cy={L.y * h}
            r={L.r * side}
            tabIndex={0}
            role="group"
            aria-label="Lens: drag to move, scroll or + and − to resize"
            data-x={L.x.toFixed(3)}
            data-y={L.y.toFixed(3)}
            data-r={L.r.toFixed(3)}
            onKeyDown={lensKey}
          />
          {pill(props.labelOf(inLens), L.x * w, (L.y + (L.r * side) / h) * h + fs * 0.4, "lens", true)}
        </>
      ) : (
        boxes.map((b, k) => (
          <g key={k}>
            <g className="cmp-box" data-band={b.step} clipPath={`url(#${id}-b${k})`}>
              <rect x={0} y={0} width={w} height={h} className="paper" />
              {layers(b.step)}
            </g>
            <rect
              className={`cmp-box-frame${drag?.t === "new" && k === boxes.length - 1 ? " drawing" : ""}`}
              x={b.x * w}
              y={b.y * h}
              width={b.w * w}
              height={b.h * h}
              tabIndex={0}
              role="group"
              aria-label={`Box ${k + 1}: drag to move, arrow keys to nudge, Delete to remove`}
              data-rect={[b.x, b.y, b.w, b.h].map((n) => n.toFixed(3)).join(",")}
              onKeyDown={(e) => boxKey(k, e)}
            />
            <rect className="cmp-box-corner" x={(b.x + b.w) * w - corner} y={(b.y + b.h) * h - corner} width={corner} height={corner} />
            {b.w * w > fs * 3 && b.h * h > fs * 2.2 && pill(props.labelOf(b.step), b.x * w + fs * 0.3, b.y * h + fs * 0.3, `p${k}`)}
          </g>
        ))
      )}
      {pill(props.labelOf(under) && `Under: ${props.labelOf(under)}`, fs * 0.5, fs * 0.5, "under")}
    </svg>
  );
}
