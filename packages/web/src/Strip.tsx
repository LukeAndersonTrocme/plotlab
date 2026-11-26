import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { StageKind } from "@plotlab/engine";
import { useBlobUrl } from "./StageView.tsx";
import { STAGE_NAMES, STAGES, type StripBox } from "./strip.ts";
import { THUMB } from "./view.ts";

const stageVar = (k: StageKind) => `var(--st-${k === "geometry" ? "lines" : k})`;

function Thumb(props: { png: Blob | undefined }) {
  const url = useBlobUrl(props.png);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="pic-empty" aria-hidden="true" />;
}

/**
 * The recipe as a row of boxes along the bottom (#66): the source, then each step with a
 * thumbnail of its output, its stage colours and a bypass toggle. Click (or Enter) shows
 * that step on the canvas and its settings in the sidebar. The grip and − / + resize it.
 */
export function Strip(props: {
  boxes: StripBox[];
  thumbs: Record<string, Blob>;
  /** Key of the selected box ("source" or a step id); null when the result is shown. */
  selected: string | null;
  /** Thumbnail size in CSS px. */
  size: number;
  onSelect: (key: string) => void;
  onBypass: (index: number) => void;
  onResize: (px: number) => void;
  onNotice: (msg: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const steps = props.boxes.length - 1;

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
    <section className="strip-wrap" aria-label="Recipe steps" style={{ "--thumb": `${props.size}px` } as CSSProperties}>
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
        <span className="strip-hint">
          {steps} {steps === 1 ? "step" : "steps"} · click a box to see that step and its settings
        </span>
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
      <div className="strip" ref={row} onKeyDown={onKey}>
        {props.boxes.map((b) => {
          const changes = b.input !== b.output;
          const selected = props.selected === b.key;
          const name = b.index < 0 ? "the source" : b.title;
          return (
            <div
              key={b.key}
              data-key={b.key}
              className={["box", selected ? "sel" : "", b.enabled ? "" : "off", b.index < 0 ? "source" : ""].join(" ")}
              style={{ "--in": stageVar(b.input), "--out": stageVar(b.output) } as CSSProperties}
              onClick={() => props.onSelect(b.key)}
            >
              <button className="pick" aria-pressed={selected} aria-label={`Show ${name}`} title={`Show ${name} on the canvas, with its settings`}>
                <span className={`band${changes ? "" : " same"}`} title={changes ? `${STAGE_NAMES[b.input]} in, ${STAGE_NAMES[b.output]} out` : STAGE_NAMES[b.output]}>
                  {changes ? `→ ${STAGE_NAMES[b.output]}` : STAGE_NAMES[b.output]}
                </span>
                <span className="pic">
                  <Thumb png={props.thumbs[b.key]} />
                </span>
                <span className="lbl">
                  <span className="ic" aria-hidden="true">
                    {b.icon}
                  </span>
                  <span className="name">{b.title}</span>
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
          );
        })}
      </div>
    </section>
  );
}
