import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { STAGE_WORDS, type Recipe, type StageKind, type StepRegistry } from "@plotlab/engine";
import { addMenu, dragHint, dropGaps, type AddMenu, type DropGap } from "./gaps.ts";
import { laneAddMenu, type LaneRow } from "./lanes.ts";
import { LaneRows } from "./LaneRows.tsx";
import { useBlobUrl } from "./StageView.tsx";
import { STACK_KEY, STAGE_NAMES, STAGES, STEP_DRAG, type StripBox, type StripLanes } from "./strip.ts";
import { THUMB } from "./view.ts";

const stageVar = (k: StageKind) => `var(--st-${k === "geometry" ? "lines" : k})`;

export function Thumb(props: { png: Blob | undefined }) {
  const url = useBlobUrl(props.png);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="pic-empty" aria-hidden="true" />;
}

/**
 * The recipe as a row of boxes along the bottom (#66): the source, then each step with a
 * thumbnail of its output, its stage colours and a bypass toggle. Click (or Enter) shows
 * that step on the canvas and its settings in the sidebar. The grip and − / + resize it.
 * A "+" between boxes adds a step that fits there; dragging a box shows where it can go,
 * and dropping it on the sidebar pins it. Pinned boxes carry a mark.
 */
export function Strip(props: {
  recipe: Recipe;
  registry: StepRegistry;
  boxes: StripBox[];
  thumbs: Record<string, Blob>;
  /** Key of the selected box ("source" or a step id); null when the result is shown. */
  selected: string | null;
  /** Thumbnail size in CSS px. */
  size: number;
  /** Ids of the pinned steps. */
  pins: readonly string[];
  /** `shift`: shift-click (while comparing, that adds the step as a strip). */
  onSelect: (key: string, shift: boolean) => void;
  /** Compare stages is on: a click only shows the step's settings; shift-click adds it as a strip. */
  comparing?: boolean;
  onBypass: (index: number) => void;
  onResize: (px: number) => void;
  onNotice: (msg: string) => void;
  /** Add the step `stepId` at gap `gap` (just before chain position `gap`). */
  onAdd: (gap: number, stepId: string) => void;
  /** Move the step at chain position `from` into gap `gap`. */
  onMove: (from: number, gap: number) => void;
  /** The CMYK lane row when the picture is split (`stripLanes`), else null. */
  lanes: StripLanes | null;
  onUnsplit: () => void;
  onScreenAngles: (on: boolean) => void;
  /** Independent inks: the lane rows to show (`laneRows`); null when linked or not split. */
  laneRows: LaneRow[] | null;
  /** Every lane, or one ink's tab. */
  laneView: "all" | string;
  onShowLanes: (which: "all" | string) => void;
  /** Key of the selected lane box (`laneKey`), or null. */
  selectedLane: string | null;
  /** Inks hidden from the stack (only the view). */
  hidden: ReadonlySet<string>;
  onLaneSelect: (id: string, layer: string) => void;
  onLaneAdd: (layer: string, at: number, stepId: string) => void;
  onLaneMove: (id: string, layer: string, to: number) => void;
  /** Drag lane `from` to place `to` (lane order is the pass order). */
  onMoveLane: (from: number, to: number) => void;
  onUnlink: () => void;
  /** Link onto lane `layer` (lossy: the app saves a checkpoint first). */
  onLink: (layer: string) => void;
  /** What linking onto lane `layer` would lose (`linkWarning`). */
  linkWarning: (layer: string) => string;
  /** The lane to link onto unless another is picked: the lane being looked at, else the first. */
  linkLane: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const steps = props.boxes.length - 1;
  /** The open "+" menu: a gap in the chain, or (`lane`) a gap in one ink's lane. */
  const [menu, setMenu] = useState<{ gap: number; left: number; bottom: number; lane?: { layer: string; at: number } } | null>(null);
  const [drag, setDrag] = useState<{ from: number; gaps: Map<number, DropGap>; hint: string } | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const openMenu = (gap: number, anchor: HTMLElement, lane?: { layer: string; at: number }) => {
    if (menu && menu.gap === gap && menu.lane?.layer === lane?.layer && menu.lane?.at === lane?.at) return setMenu(null);
    const r = anchor.getBoundingClientRect();
    setMenu({ gap, left: Math.max(8, Math.min(window.innerWidth - 300, r.left - 130)), bottom: window.innerHeight - r.top + 8, ...(lane ? { lane } : {}) });
  };
  const own = props.laneRows !== null;
  const startDrag = (from: number) => {
    setMenu(null);
    const gaps = new Map(dropGaps(props.recipe, props.registry, from).map((g) => [g.gap, g]));
    setDrag({ from, gaps, hint: dragHint(props.recipe, props.registry, from) });
  };
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  // Left/right arrows move between boxes; Enter or Space (the button's own) selects.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const picks = [...(row.current?.querySelectorAll<HTMLButtonElement>("button.pick") ?? [])];
    const i = picks.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    picks[Math.max(0, Math.min(picks.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))]?.focus();
  };

  const onGrip = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, s0 = props.size;
    const move = (ev: globalThis.PointerEvent) => props.onResize(s0 + (y0 - ev.clientY));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <section className={`strip-wrap${drag ? " dragging" : ""}`} aria-label="Recipe steps" style={{ "--thumb": `${props.size}px`, "--thumb-base": `${props.size}px` } as CSSProperties}>
      <div
        className="strip-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the thumbnails"
        aria-valuemin={THUMB.min}
        aria-valuemax={THUMB.max}
        aria-valuenow={props.size}
        tabIndex={0}
        title="Drag to make the thumbnails bigger or smaller"
        onPointerDown={onGrip}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          props.onResize(props.size + (e.key === "ArrowUp" ? THUMB.step : -THUMB.step));
        }}
      />
      <div className="strip-head">
        <strong>Recipe</strong>
        <span className={`strip-hint${drag ? " drag-hint" : ""}`} aria-live="polite">
          {drag ? `${drag.hint} Or drop it on the sidebar to pin it.` : `${steps} ${steps === 1 ? "step" : "steps"} · click a box to see that step and its settings, drag it to move it, + to add a step`}
        </span>
        {props.lanes && (
          <LanesBar
            lanes={props.lanes}
            onUnsplit={props.onUnsplit}
            onScreenAngles={props.onScreenAngles}
            laneView={props.laneView}
            onShowLanes={props.onShowLanes}
            onUnlink={props.onUnlink}
            onLink={props.onLink}
            linkWarning={props.linkWarning}
            linkLane={props.linkLane}
          />
        )}
        <span className="legend" aria-label="Stage colours">
          {STAGES.map((k) => (
            <span key={k} style={{ "--st": stageVar(k) } as CSSProperties}>
              <i aria-hidden="true" />
              {STAGE_NAMES[k]}
            </span>
          ))}
        </span>
        <span className="size-btns">
          <span>Thumbnails</span>
          <button aria-label="Smaller thumbnails" disabled={props.size <= THUMB.min} onClick={() => props.onResize(props.size - THUMB.step)}>
            −
          </button>
          <button aria-label="Bigger thumbnails" disabled={props.size >= THUMB.max} onClick={() => props.onResize(props.size + THUMB.step)}>
            +
          </button>
        </span>
      </div>
      <div className="strip" ref={row} onKeyDown={onKey} onScroll={() => setMenu(null)}>
        {props.boxes.map((b) => {
          // Independent inks: the lane steps are in the lane rows, after the split.
          if (own && b.lane === "lane") return null;
          const changes = b.input !== b.output;
          const selected = props.selected === b.key;
          const pinned = b.index >= 0 && props.pins.includes(b.key);
          const name = b.index < 0 ? "the source" : b.title;
          const gap = b.index + 1;
          const drop = drag?.gaps.get(gap);
          return (
            <Fragment key={b.key}>
              <div
                data-key={b.key}
                className={["box", selected ? "sel" : "", pinned ? "pinned" : "", b.enabled ? "" : "off", b.index < 0 ? "source" : "", b.lane ? `lane ${b.lane}` : "", drag?.from === b.index ? "dragging" : ""].join(" ")}
                style={{ "--in": stageVar(b.input), "--out": stageVar(b.output) } as CSSProperties}
                onClick={(e) => props.onSelect(b.key, e.shiftKey)}
                draggable={b.index >= 0}
                onDragStart={(e) => {
                  if (b.index < 0) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", b.key);
                  e.dataTransfer.setData(STEP_DRAG, b.key);
                  startDrag(b.index);
                }}
                onDragEnd={endDrag}
              >
                <button className="pick" aria-pressed={selected} aria-label={`Show ${name}${pinned ? " (pinned)" : ""}`} title={props.comparing ? `Show ${name}'s settings (shift-click: add it as a strip)` : `Show ${name} on the canvas, with its settings`}>
                  <span className={`band${changes ? "" : " same"}`} title={changes ? `${STAGE_NAMES[b.input]} in, ${STAGE_NAMES[b.output]} out` : STAGE_NAMES[b.output]}>
                    {changes ? `→ ${STAGE_NAMES[b.output]}` : STAGE_NAMES[b.output]}
                  </span>
                  <span className={`pic${b.lane ? " quad" : ""}`} title={b.lane && props.lanes ? `${props.lanes.names.join(", ")}: one ink in each corner` : undefined}>
                    <Thumb png={props.thumbs[b.key]} />
                  </span>
                  <span className="lbl">
                    <span className="ic" aria-hidden="true">
                      {b.icon}
                    </span>
                    <span className="name">{b.title}</span>
                    {pinned && <span className="pin-mark" title="Pinned: its settings stay in the sidebar" aria-hidden="true" />}
                  </span>
                  {b.status === "waiting" && <span className="box-note">Not run yet: traced order</span>}
                  {b.status === "off" && <span className="box-note">Switched off</span>}
                </button>
                {b.bypass && (
                  <button
                    className="byp"
                    aria-pressed={b.enabled}
                    aria-disabled={!b.bypass.ok}
                    aria-label={b.bypass.ok ? `${b.enabled ? "Switch off" : "Switch on"} ${b.title}` : b.bypass.reason}
                    title={b.bypass.ok ? (b.enabled ? "On. Click to switch this step off and see the difference." : "Off. Click to switch this step back on.") : b.bypass.reason}
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
              {own && b.lane === "split" ? (
                <LaneRows
                  rows={props.laneRows!}
                  all={props.laneView === "all"}
                  thumbs={props.thumbs}
                  selected={props.selectedLane}
                  hidden={props.hidden}
                  onSelect={props.onLaneSelect}
                  onBypass={props.onBypass}
                  onNotice={props.onNotice}
                  onPlus={(layer, at, anchor) => openMenu(gap, anchor, { layer, at })}
                  onMove={props.onLaneMove}
                  onMoveLane={props.onMoveLane}
                  open={menu?.lane ?? null}
                />
              ) : (
              <div
                className={["gap", drop ? (drop.ok ? "drop-ok" : "drop-no") : "", drop?.ok && over === gap ? "over" : ""].join(" ")}
                data-gap={gap}
                title={drop && !drop.ok ? drop.reason : undefined}
                onDragOver={(e) => {
                  if (!drop?.ok) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(gap);
                }}
                onDragLeave={() => setOver((o) => (o === gap ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = drag?.from;
                  endDrag();
                  // Only highlighted gaps take a drop; the move is checked again when applied.
                  if (from !== undefined && drop?.ok) props.onMove(from, gap);
                }}
              >
                <button
                  className="plus"
                  aria-label={`Add a step after ${name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.gap === gap}
                  title={`Add a step after ${name}`}
                  onClick={(e) => openMenu(gap, e.currentTarget)}
                >
                  +
                </button>
              </div>
              )}
              {props.lanes && (own ? b.lane === "split" : props.lanes.stackAfter === b.index) && (
                <StackBox png={props.thumbs[STACK_KEY]} names={props.lanes.names} selected={props.selected === null} onSelect={() => props.onSelect(STACK_KEY, false)} />
              )}
            </Fragment>
          );
        })}
      </div>
      {menu?.lane && (
        <AddMenuPop
          menu={laneAddMenu(props.recipe, props.registry, menu.lane.layer, menu.lane.at)}
          after={`${menu.lane.at === 0 ? "the split" : (props.laneRows?.find((r) => r.layer === menu.lane!.layer)?.boxes[menu.lane.at - 1]?.title ?? "")}, for ${props.laneRows?.find((r) => r.layer === menu.lane!.layer)?.name ?? menu.lane.layer} only`}
          from={`.lane-gap[data-lane-gap="${menu.lane.layer}:${menu.lane.at}"] .plus`}
          left={menu.left}
          bottom={menu.bottom}
          onPick={(id) => {
            const l = menu.lane!;
            setMenu(null);
            props.onLaneAdd(l.layer, l.at, id);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && !menu.lane && (
        <AddMenuPop
          menu={addMenu(props.recipe, props.registry, menu.gap)}
          after={menu.gap === 0 ? "the source" : (props.boxes[menu.gap]?.title ?? "")}
          from={`.strip > .gap[data-gap="${menu.gap}"] .plus`}
          left={menu.left}
          bottom={menu.bottom}
          onPick={(id) => {
            setMenu(null);
            props.onAdd(menu.gap, id);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

/**
 * The lane row's controls: the inks, Linked / Independent, the lane tabs (Independent: all
 * lanes or one ink), the print screen angles switch and Undo the split. Linking independent
 * inks is lossy, so Linked first says what changes and which lane every ink will copy.
 */
function LanesBar(props: {
  lanes: StripLanes;
  onUnsplit: () => void;
  onScreenAngles: (on: boolean) => void;
  laneView: "all" | string;
  onShowLanes: (which: "all" | string) => void;
  onUnlink: () => void;
  onLink: (layer: string) => void;
  linkWarning: (layer: string) => string;
  linkLane: string;
}) {
  const { lanes } = props;
  /** Linked was pressed while independent: the lane to link onto, waiting for a yes. */
  const [linking, setLinking] = useState<string | null>(null);
  useEffect(() => setLinking(null), [lanes.linked]);
  const linkedBtn = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLSpanElement>(null);
  const opened = linking !== null;
  // The warning takes the focus when it opens (its Link button), and gives it back to Linked.
  useEffect(() => {
    if (opened) dialog.current?.querySelector<HTMLButtonElement>(".link-warn-do .primary")?.focus();
  }, [opened]);
  const closeWarning = () => {
    setLinking(null);
    linkedBtn.current?.focus();
  };
  return (
    <span className="lanes-bar" aria-label="Inks">
      <span className="lanes-inks" title={`Split into ${lanes.names.join(", ")}.${lanes.linked ? " Each box in the row shows all four inks, one in each corner." : ""}`}>
        {lanes.layers.map((l) => (
          <span key={l} className={`ink-dot ink-${l}`} aria-hidden="true" />
        ))}
        {lanes.layers.join(" ")}
      </span>
      <span className="seg" role="group" aria-label="Linked or independent inks">
        <button
          ref={linkedBtn}
          aria-pressed={lanes.linked}
          aria-expanded={lanes.linked ? undefined : opened}
          title="Linked: one set of steps and settings drives every ink."
          onClick={() => !lanes.linked && setLinking(linking ? null : props.linkLane)}
        >
          Linked
        </button>
        <button aria-pressed={!lanes.linked} title="Independent: each ink gets its own steps and settings, in its own lane." onClick={() => lanes.linked && props.onUnlink()}>
          Independent
        </button>
      </span>
      {!lanes.linked && (
        <span className="seg lane-tabs" role="group" aria-label="Lanes to show">
          {["all", ...lanes.layers].map((v) => (
            <button key={v} aria-pressed={props.laneView === v} data-lane-tab={v} onClick={() => props.onShowLanes(v)} title={v === "all" ? "Show every ink's lane" : `Show only ${lanes.names[lanes.layers.indexOf(v)]}'s lane, with room to work`}>
              {v === "all" ? "All lanes" : v}
            </button>
          ))}
        </span>
      )}
      <label className="toggle" title="Turn each ink's Fill lines by its print screen angle (cyan 15°, magenta 75°, yellow 0°, black 45°), so the inks don't all hatch the same way.">
        <input type="checkbox" checked={lanes.screenAngles} onChange={(e) => props.onScreenAngles(e.target.checked)} /> Screen angles
      </label>
      <button className="link" onClick={props.onUnsplit} title="Go back to the single chain you had before splitting (the split version is saved as a checkpoint).">
        Undo the split
      </button>
      {linking && (
        <span
          ref={dialog}
          className="link-warn"
          role="alertdialog"
          aria-label="Link the inks?"
          aria-describedby="link-warn-text"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            closeWarning();
          }}
        >
          <span id="link-warn-text">{props.linkWarning(linking)}</span>
          <span className="link-warn-pick">
            Copy the lane of
            {lanes.layers.map((l, i) => (
              <button key={l} className={linking === l ? "chip on" : "chip"} aria-pressed={linking === l} onClick={() => setLinking(l)}>
                {lanes.names[i]}
              </button>
            ))}
          </span>
          <span className="link-warn-do">
            <button
              className="primary"
              onClick={() => {
                const l = linking;
                setLinking(null);
                props.onLink(l);
              }}
            >
              Link every ink to {lanes.names[lanes.layers.indexOf(linking)]}
            </button>
            <button onClick={closeWarning}>Cancel</button>
          </span>
        </span>
      )}
    </span>
  );
}

/** Where the lanes merge: all the inks together. Clicking it shows the end result. */
function StackBox(props: { png: Blob | undefined; names: string[]; selected: boolean; onSelect: () => void }) {
  return (
    <div data-key={STACK_KEY} className={`box stack${props.selected ? " sel" : ""}`} style={{ "--in": stageVar("geometry"), "--out": stageVar("geometry") } as CSSProperties} onClick={props.onSelect}>
      <button className="pick" aria-pressed={props.selected} aria-label="Show the stack: all inks together" title={`The stack: ${props.names.join(", ")} together, as they will print`}>
        <span className="band same">Stack</span>
        <span className="pic">
          <Thumb png={props.png} />
        </span>
        <span className="lbl">
          <span className="ic" aria-hidden="true">
            ☰
          </span>
          <span className="name">Stack</span>
        </span>
      </button>
    </div>
  );
}

/** The menu a "+" opens: only the steps that fit at that gap (`addMenu`, or a lane's `laneAddMenu`), or why nothing does. */
export function AddMenuPop(props: {
  menu: AddMenu;
  /** Name of the box before the gap. */
  after: string;
  /** Where the "+" it came from is, to go back to it on Escape (a CSS selector). */
  from: string;
  left: number;
  bottom: number;
  onPick: (stepId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const m = props.menu;
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const away = (e: globalThis.PointerEvent) => {
      const t = e.target as Element | null;
      if (!ref.current?.contains(t) && !t?.closest?.(".gap .plus")) close.current();
    };
    const resize = () => close.current();
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", resize);
    };
  }, []);
  const close_ = () => {
    // Back to the "+" it came from, for keyboard use.
    document.querySelector<HTMLButtonElement>(props.from)?.focus();
    props.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close_();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div
      ref={ref}
      className="add-menu"
      role="menu"
      aria-label={`Steps that fit after ${props.after}`}
      style={{ left: props.left, bottom: props.bottom }}
      onKeyDown={onKey}
    >
      <div className="add-head">
        <strong>Add after {props.after}</strong>
        <span>The chain has {STAGE_WORDS[m.stage]} here.</span>
      </div>
      {m.options.map((o) => (
        <button key={o.id} role="menuitem" data-step={o.id} onClick={() => props.onPick(o.id)}>
          <span className="ic" aria-hidden="true">
            {o.icon}
          </span>
          <span className="add-text">
            <span className="add-title">
              <strong>{o.title}</strong>
              <span className="pill" style={{ "--st": stageVar(o.output) } as CSSProperties} title={`Gives ${STAGE_NAMES[o.output].toLowerCase()}`}>
                {STAGE_NAMES[o.output]}
              </span>
              {o.experimental && <span className="badge experimental">experimental</span>}
            </span>
            <small>{o.split ? `Splits the picture into inks: the steps after it apply to every ink. ${o.summary}` : o.summary}</small>
          </span>
        </button>
      ))}
      {m.reason && <p className="add-none">{m.reason}</p>}
      {m.options.length === 0 && (
        <button className="add-close" onClick={close_}>
          Close
        </button>
      )}
    </div>
  );
}
