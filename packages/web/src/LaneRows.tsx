import { Fragment, useState, type CSSProperties } from "react";
import type { StageKind } from "@plotlab/engine";
import { Thumb } from "./Strip.tsx";
import type { LaneRow } from "./lanes.ts";
import { STAGE_NAMES } from "./strip.ts";

const stageVar = (k: StageKind) => `var(--st-${k === "geometry" ? "lines" : k})`;

/** What's being dragged in the lanes: a step within its lane, or a lane by its handle (to change the pass order). */
type Drag = { kind: "step"; layer: string; id: string; pos: number } | { kind: "lane"; from: number };

/**
 * Independent inks (#66): one row per lane, in pass order (or the one lane picked by its tab).
 * Each row starts with the ink's handle (drag it to change the pass order), then that ink's
 * steps, each showing only that ink, with a "+" between them that adds a step for that ink only.
 * Dragging a step along its row moves it within the lane.
 */
export function LaneRows(props: {
  rows: LaneRow[];
  /** All lanes at once: smaller boxes, so four rows fit. */
  all: boolean;
  thumbs: Record<string, Blob>;
  /** Key of the selected lane box (`laneKey`), or null. */
  selected: string | null;
  /** Inks hidden from the stack (only the view). */
  hidden: ReadonlySet<string>;
  onSelect: (id: string, layer: string) => void;
  onBypass: (index: number) => void;
  onNotice: (msg: string) => void;
  /** A lane's "+": `at` is the place in the lane (0 = right after the split). */
  onPlus: (layer: string, at: number, anchor: HTMLElement) => void;
  /** Move a step to place `to` in its lane (counted without it). */
  onMove: (id: string, layer: string, to: number) => void;
  /** Drag lane `from` (its place in pass order) to place `to`. */
  onMoveLane: (from: number, to: number) => void;
  /** The lane gap whose "+" menu is open. */
  open: { layer: string; at: number } | null;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const end = () => {
    setDrag(null);
    setOver(null);
  };
  return (
    <div className={`lane-rows${props.all ? " small" : ""}`} role="group" aria-label="Lanes: one row per ink, in pass order">
      {props.rows.map((row, ri) => {
        const laneOver = drag?.kind === "lane" && over === `lane:${ri}`;
        return (
          <div
            key={row.layer}
            className={["lane-row", props.hidden.has(row.layer) ? "hidden-lane" : "", laneOver ? "over" : ""].join(" ")}
            data-lane={row.layer}
            onDragOver={(e) => {
              if (drag?.kind !== "lane" || drag.from === ri) return;
              e.preventDefault();
              setOver(`lane:${ri}`);
            }}
            onDrop={(e) => {
              if (drag?.kind !== "lane") return;
              e.preventDefault();
              const from = drag.from;
              end();
              if (from !== ri) props.onMoveLane(from, ri);
            }}
          >
            <span
              className="lane-head"
              draggable={props.all}
              data-lane-handle={row.layer}
              title={props.all ? `${row.name}: drag to change the pass order (which ink plots first)` : row.name}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", row.layer);
                setDrag({ kind: "lane", from: ri });
              }}
              onDragEnd={end}
            >
              {props.all && (
                <span className="grip" aria-hidden="true">
                  ⋮⋮
                </span>
              )}
              <span className={`ink-badge ink-${row.layer}`}>{row.layer}</span>
            </span>
            <LaneGap row={row} at={0} drag={drag} over={over} setOver={setOver} open={props.open} onPlus={props.onPlus} onDrop={(to) => drag?.kind === "step" && (end(), props.onMove(drag.id, drag.layer, to))} />
            {row.boxes.map((b, pos) => {
              const selected = props.selected === b.key;
              const changes = b.input !== b.output;
              const id = b.key.slice(0, b.key.indexOf("@"));
              return (
                <Fragment key={b.key}>
                  <div
                    data-key={b.key}
                    className={["box", "lane", "ink", selected ? "sel" : "", b.enabled ? "" : "off", drag?.kind === "step" && drag.id === id && drag.layer === row.layer ? "dragging" : ""].join(" ")}
                    style={{ "--in": stageVar(b.input), "--out": stageVar(b.output) } as CSSProperties}
                    onClick={() => props.onSelect(id, row.layer)}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", b.key);
                      setDrag({ kind: "step", layer: row.layer, id, pos });
                    }}
                    onDragEnd={end}
                  >
                    <button className="pick" aria-pressed={selected} aria-label={`Show ${b.title} for ${row.name}`} title={`${b.title} for ${row.name}: show it, with ${row.name.toLowerCase()}'s settings`}>
                      <span className={`band${changes ? "" : " same"}`}>{changes ? `→ ${STAGE_NAMES[b.output]}` : STAGE_NAMES[b.output]}</span>
                      <span className="pic">
                        <Thumb png={props.thumbs[b.key]} />
                      </span>
                      <span className="lbl">
                        <span className="ic" aria-hidden="true">
                          {b.icon}
                        </span>
                        <span className="name">{b.title}</span>
                      </span>
                      {b.status === "off" && <span className="box-note">Switched off</span>}
                    </button>
                    {b.bypass && (
                      <button
                        className="byp"
                        aria-pressed={b.enabled}
                        aria-disabled={!b.bypass.ok}
                        aria-label={b.bypass.ok ? `${b.enabled ? "Switch off" : "Switch on"} ${b.title}` : b.bypass.reason}
                        title={b.bypass.ok ? (b.enabled ? "On. Click to switch this step off (for every ink it works on)." : "Off. Click to switch it back on.") : b.bypass.reason}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (b.bypass?.ok) props.onBypass(b.index);
                          else if (b.bypass) props.onNotice(b.bypass.reason);
                        }}
                      >
                        {b.enabled ? "●" : "○"}
                      </button>
                    )}
                  </div>
                  <LaneGap row={row} at={pos + 1} drag={drag} over={over} setOver={setOver} open={props.open} onPlus={props.onPlus} onDrop={(to) => drag?.kind === "step" && (end(), props.onMove(drag.id, drag.layer, to))} />
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** A gap in a lane: its "+" adds a step for that ink only; a step dragged along the lane drops here. */
function LaneGap(props: {
  row: LaneRow;
  at: number;
  drag: Drag | null;
  over: string | null;
  setOver: (k: string | null) => void;
  open: { layer: string; at: number } | null;
  onPlus: (layer: string, at: number, anchor: HTMLElement) => void;
  /** Dropped here: the dragged step's new place in the lane (counted without it). */
  onDrop: (to: number) => void;
}) {
  const { row, at, drag } = props;
  const k = `${row.layer}:${at}`;
  // A step of this lane, and not the gaps right beside it (no change).
  const target = drag?.kind === "step" && drag.layer === row.layer && at !== drag.pos && at !== drag.pos + 1;
  const after = at === 0 ? "the split" : (row.boxes[at - 1]?.title ?? "");
  return (
    <div
      className={["gap", "lane-gap", target ? "drop-ok" : "", target && props.over === k ? "over" : ""].join(" ")}
      data-lane-gap={k}
      onDragOver={(e) => {
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        props.setOver(k);
      }}
      onDrop={(e) => {
        if (!target || drag?.kind !== "step") return;
        e.preventDefault();
        e.stopPropagation();
        props.onDrop(at > drag.pos ? at - 1 : at);
      }}
    >
      <button
        className="plus"
        aria-label={`Add a step for ${row.name} only, after ${after}`}
        aria-haspopup="menu"
        aria-expanded={props.open?.layer === row.layer && props.open.at === at}
        title={`Add a step for ${row.name} only, after ${after}`}
        onClick={(e) => props.onPlus(row.layer, at, e.currentTarget)}
      >
        +
      </button>
    </div>
  );
}
