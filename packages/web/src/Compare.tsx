import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Paper } from "@plotlab/engine";
import { addBand, dragSplit, everyStep, MAX_STRIPS, nextBand, removeBand, setBand, setLayout, thisVsBefore, type Chain, type Compare } from "./compare.ts";
import type { InspectTarget, InspectView } from "./protocol.ts";
import { StageLayers } from "./StageView.tsx";

/** A strip's step, for its chip and label: "source" or a step id, with its name. */
export type BandOption = { key: string; label: string };

/** Whether a view from the worker is of the stage this strip asks for (a newer run may still be on its way). */
const shows = (v: InspectView | null | undefined, t: InspectTarget | undefined): v is InspectView => !!v && v.index === (t === "source" ? -1 : t);

/**
 * Compare stages (#75): the paper split into strips, each showing one step's output (or the
 * source), with draggable dividers. A divider drag is drawn here and handed up once, on release,
 * so a drag is one view change (and one save of the view block).
 */
export function CompareCanvas(props: {
  paper: Paper;
  compare: Compare;
  /** What each strip asks the worker for (`compareTargets`), to match `views` against. */
  targets: InspectTarget[];
  views: Array<InspectView | null> | null;
  labels: string[];
  hidden: Set<string>;
  showTravel: boolean;
  busy: boolean;
  onChange: (c: Compare) => void;
}) {
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
    if (drag && drag.c !== props.compare) props.onChange(drag.c);
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
        const v = props.views?.[k];
        const ok = shows(v, props.targets[k]);
        const r = rect(edges[k]!, edges[k + 1]!);
        return (
          <g key={k} clipPath={`url(#${id}-${k})`} className="strip-band" data-band={band}>
            {ok ? (
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
        const label = props.labels[k] ?? "";
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

/**
 * The bar above the canvas while comparing: the layout, a chip per strip to pick its step (and
 * remove it), + Strip, and the two shortcuts.
 */
export function CompareBar(props: { compare: Compare; chain: Chain; selected: number; options: BandOption[]; onChange: (c: Compare) => void }) {
  const { compare: c, onChange } = props;
  const name = (key: string) => props.options.find((o) => o.key === key)?.label ?? key;
  return (
    <div className="compare-bar" role="group" aria-label="Compare stages">
      <span className="seg">
        {(
          [
            ["cols", "▥ Side by side"],
            ["rows", "▤ Top to bottom"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} aria-pressed={c.layout === k} onClick={() => onChange(setLayout(c, k))}>
            {label}
          </button>
        ))}
      </span>
      <span className="muted">{c.layout === "rows" ? "Top to bottom:" : "Left to right:"}</span>
      {c.bands.map((band, k) => (
        <span key={k} className="band-chip">
          <select aria-label={`Strip ${k + 1}`} value={band} onChange={(e) => onChange(setBand(c, k, e.target.value))} title={name(band)}>
            {props.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {c.bands.length > 1 && (
            <button aria-label={`Remove strip ${k + 1}`} title="Remove this strip" onClick={() => onChange(removeBand(c, k))}>
              ×
            </button>
          )}
        </span>
      ))}
      <button className="cmp-add" disabled={c.bands.length >= MAX_STRIPS} title={c.bands.length >= MAX_STRIPS ? "Six strips is the most" : "Add a strip (or shift-click a thumbnail)"} onClick={() => onChange(addBand(c, nextBand(c, props.chain)))}>
        + Strip
      </button>
      <span className="quick">
        <button onClick={() => onChange(thisVsBefore(props.chain, props.selected, c.layout))}>This step vs the one before</button>
        <button onClick={() => onChange(everyStep(props.chain, c.layout))}>Every step</button>
      </span>
    </div>
  );
}
