import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Paper } from "@plotlab/engine";
import { addBand, applySplits, dragSplit, stripView, everyStep, MAX_BOXES, MAX_LENS, MAX_STRIPS, MIN_LENS, nextBand, removeBand, removeBox, resizeLens, setBand, setBoxStep, setInLens, setLayout, setUnder, thisVsBefore, type Band, type Chain, type Compare } from "./compare.ts";
import { LensBoxesCanvas } from "./LensBoxes.tsx";
import type { InspectTarget, InspectView } from "./protocol.ts";
import { StageLayers } from "./StageView.tsx";

/** A strip's step, for its chip and label: "source" or a step id, with its name. */
export type BandOption = { key: string; label: string };

/**
 * Compare stages (#75): the paper split into strips, each showing one step's output (or the
 * source), with draggable dividers. A divider drag is drawn here and handed up once, on release,
 * so a drag is one view change (and one save of the view block).
 */
export function CompareCanvas(props: {
  paper: Paper;
  compare: Compare;
  /** What the worker was asked for (`compareTargets`: one per shown step), to match `views` against. */
  targets: InspectTarget[];
  views: Array<InspectView | null> | null;
  /** A step's name (or "Image" for the source); empty for a removed step until the view catches up. */
  labelOf: (band: Band) => string;
  hidden: Set<string>;
  showTravel: boolean;
  busy: boolean;
  /** The step being looked at: what a newly drawn box shows. */
  looking: Band;
  onChange: (c: Compare) => void;
}) {
  if (props.compare.layout === "lens" || props.compare.layout === "boxes") return <LensBoxesCanvas {...props} />;
  return <StripsCanvas {...props} />;
}

function StripsCanvas(props: Parameters<typeof CompareCanvas>[0]) {
  const { widthMm: w, heightMm: h } = props.paper;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ k: number; c: Compare } | null>(null);
  const c = drag?.c ?? props.compare;
  const rows = c.layout === "rows";
  const along = rows ? h : w;
  const edges = [0, ...c.splits, 1];
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fs = Math.min(w, h) * 0.035;

  const fraction = (e: PointerEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return rows ? p.y / h : p.x / w;
  };
  const move = (e: PointerEvent) => {
    const f = drag && fraction(e);
    if (drag && f !== null) setDrag({ k: drag.k, c: dragSplit(drag.c, drag.k, f) });
  };
  const release = () => {
    // Only the dividers: a strip changed or removed during the drag stays as it is now.
    if (drag) props.onChange(applySplits(props.compare, drag.c.splits));
    setDrag(null);
  };
  const nudge = (k: number, e: KeyboardEvent) => {
    const step = { ArrowLeft: -0.01, ArrowUp: -0.01, ArrowRight: 0.01, ArrowDown: 0.01 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    props.onChange(dragSplit(props.compare, k, props.compare.splits[k]! + step));
  };
  const rect = (a: number, z: number) => (rows ? { x: 0, y: h * a, width: w, height: h * (z - a) } : { x: w * a, y: 0, width: w * (z - a), height: h });

  return (
    <svg ref={svg} className={`preview compare-canvas ${rows ? "rows" : "cols"}`} viewBox={`-5 -5 ${w + 10} ${h + 10}`} preserveAspectRatio="xMidYMid meet" aria-label="Compare stages">
      <defs>
        {c.bands.map((_, k) => (
          <clipPath key={k} id={`${id}-${k}`}>
            <rect {...rect(edges[k]!, edges[k + 1]!)} />
          </clipPath>
        ))}
      </defs>
      <rect x={0} y={0} width={w} height={h} className="paper" />
      {c.bands.map((band, k) => {
        const v = stripView(props.views, c.bands, props.targets, k);
        const r = rect(edges[k]!, edges[k + 1]!);
        return (
          <g key={k} clipPath={`url(#${id}-${k})`} className="strip-band" data-band={band}>
            {v ? (
              <StageLayers rasters={v.rasters} plot={v.plot} showTravel={props.showTravel && v.kind === "plot"} underlay={null} hidden={props.hidden} />
            ) : (
              <text x={r.x + r.width / 2} y={r.y + r.height / 2} textAnchor="middle" className="empty-text" fontSize={fs}>
                {props.busy ? "Working…" : "Nothing here"}
              </text>
            )}
          </g>
        );
      })}
      {c.bands.map((_, k) => {
        const label = props.labelOf(c.bands[k]!);
        const r = rect(edges[k]!, edges[k + 1]!);
        const tw = label.length * fs * 0.58 + fs;
        if ((rows ? r.height : r.width) < (rows ? fs * 2.2 : tw + fs * 0.4)) return null;
        const x = rows ? fs * 0.5 : r.x + r.width / 2 - tw / 2;
        const y = r.y + fs * 0.5;
        return (
          <g key={`l${k}`} className="cmp-label" aria-hidden="true">
            <rect x={x} y={y} width={tw} height={fs * 1.6} rx={fs * 0.8} />
            <text x={x + tw / 2} y={y + fs * 1.15} textAnchor="middle" fontSize={fs}>
              {label}
            </text>
          </g>
        );
      })}
      {c.splits.map((s, k) => {
        const at = along * s;
        const reach = Math.max(w, h) * 0.03;
        const knob = Math.min(w, h) * 0.03;
        // Handles are staggered along the divider, so two dividers dragged close keep both handles in reach.
        const mid = (rows ? w : h) * (0.5 + (k - (c.splits.length - 1) / 2) * 0.12);
        return (
          <g
            key={`d${k}`}
            className={`cmp-divider${drag?.k === k ? " dragging" : ""}`}
            role="slider"
            tabIndex={0}
            aria-label={`Divider ${k + 1}`}
            aria-orientation={rows ? "vertical" : "horizontal"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(s * 100)}
            onKeyDown={(e) => nudge(k, e)}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ k, c: props.compare });
            }}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <rect className="hit" {...(rows ? { x: 0, y: at - reach / 2, width: w, height: reach } : { x: at - reach / 2, y: 0, width: reach, height: h })} />
            <line {...(rows ? { x1: 0, x2: w, y1: at, y2: at } : { x1: at, x2: at, y1: 0, y2: h })} />
            <circle cx={rows ? mid : at} cy={rows ? at : mid} r={knob} />
            <text x={rows ? mid : at} y={(rows ? at : mid) + knob * 0.35} textAnchor="middle" fontSize={knob}>
              {rows ? "⇕" : "⇔"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** What shift-click on a thumbnail does, in the words of the layout. */
export const shiftHint = (c: Compare) =>
  c.layout === "lens" ? "Shift-click a thumbnail to show it in the lens" : c.layout === "boxes" ? "Shift-click a thumbnail to add a box showing it" : "Shift-click a thumbnail to add it as a strip";

/**
 * The bar above the canvas while comparing: the layout, then per layout a chip per strip to
 * pick its step (and remove it) with + Strip; what's under and in the lens with its size; or
 * what's under the boxes and a chip per box. Then the shortcuts.
 */
export function CompareBar(props: { compare: Compare; chain: Chain; selected: number; options: BandOption[]; looking: Band; aspect: number; onChange: (c: Compare) => void }) {
  const { compare: c, onChange } = props;
  const name = (key: string) => props.options.find((o) => o.key === key)?.label ?? key;
  const strips = c.layout === "cols" || c.layout === "rows";
  /** A step chip; an option is greyed out when picking it would change nothing (the rule for that chip). */
  const chip = (label: string, value: Band, pick: (b: Band) => Compare, extra?: ReactNode) => (
    <span key={label} className="band-chip">
      <select aria-label={label} value={value} onChange={(e) => onChange(pick(e.target.value))} title={name(value)}>
        {props.options.map((o) => (
          <option key={o.key} value={o.key} disabled={o.key !== value && pick(o.key) === c}>
            {o.label}
          </option>
        ))}
      </select>
      {extra}
    </span>
  );
  // Switching to the lens with one step puts the step being looked at in it (or the next one).
  const fill = props.looking !== c.bands[0] ? props.looking : nextBand(c, props.chain);
  return (
    <div className="compare-bar" role="group" aria-label="Compare stages">
      <span className="seg">
        {(
          [
            ["cols", "▥ Side by side"],
            ["rows", "▤ Top to bottom"],
            ["lens", "◯ Lens"],
            ["boxes", "▢ Boxes"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} aria-pressed={c.layout === k} onClick={() => onChange(setLayout(c, k, fill))}>
            {label}
          </button>
        ))}
      </span>
      {strips && (
        <>
          <span className="muted">{c.layout === "rows" ? "Top to bottom:" : "Left to right:"}</span>
          {c.bands.map((band, k) =>
            chip(
              `Strip ${k + 1}`,
              band,
              (b) => setBand(c, k, b),
              c.bands.length > 1 && (
                <button aria-label={`Remove strip ${k + 1}`} title="Remove this strip" onClick={() => onChange(removeBand(c, k))}>
                  ×
                </button>
              ),
            ),
          )}
          <button className="cmp-add" disabled={c.bands.length >= MAX_STRIPS} title={c.bands.length >= MAX_STRIPS ? "Six strips is the most" : "Add a strip (or shift-click a thumbnail)"} onClick={() => onChange(addBand(c, nextBand(c, props.chain)))}>
            + Strip
          </button>
        </>
      )}
      {!strips && <span className="muted">Under:</span>}
      {!strips && chip(c.layout === "lens" ? "Under the lens" : "Under the boxes", c.bands[0]!, (b) => setUnder(c, b))}
      {c.layout === "lens" && (
        <>
          <span className="muted">In the lens:</span>
          {chip("In the lens", c.bands[1] ?? c.bands[0]!, (b) => setInLens(c, b))}
          <label className="muted lens-size">
            Size <input type="range" aria-label="Lens size" min={MIN_LENS} max={MAX_LENS} step={0.01} value={c.lens.r} onChange={(e) => onChange(resizeLens(c, Number(e.target.value), props.aspect))} />
          </label>
        </>
      )}
      {c.layout === "boxes" && (
        <>
          {c.boxes.map((b, k) => (
            <span key={`b${k}`} className="box-chip">
              <span className="muted">Box {k + 1}:</span>
              {chip(`Box ${k + 1}`, b.step, (s) => setBoxStep(c, k, s),
                <button aria-label={`Remove box ${k + 1}`} title="Remove this box" onClick={() => onChange(removeBox(c, k))}>
                  ×
                </button>,
              )}
            </span>
          ))}
          <span className="muted hint">{c.boxes.length >= MAX_BOXES ? "Six boxes is the most." : "Drag on the image to draw a box. It shows the step you're looking at."}</span>
        </>
      )}
      <span className="quick">
        <button onClick={() => onChange(thisVsBefore(props.chain, props.selected, c.layout, strips ? undefined : c))}>This step vs the one before</button>
        {strips && <button onClick={() => onChange(everyStep(props.chain, c.layout))}>Every step</button>}
      </span>
    </div>
  );
}
