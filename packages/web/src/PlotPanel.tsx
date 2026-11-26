import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FORMAT_LABEL, type ExportFormat, type Plot, type Recipe, type StepRegistry } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import { advance, frameLabel, movePass, outputFormats, sendState, startPlay, timeRows, type PassBox } from "./plotmode.ts";
import type { StepInfo } from "./protocol.ts";
import { fmtTime } from "./setup.ts";
import { Thumb } from "./Strip.tsx";

/**
 * The plot-order animation's position (0 = nothing drawn, 1 = the whole plot) and Play /
 * Pause. Only the view: never a recipe edit. Stops and shows the whole plot when `active`
 * goes false (leaving Plot mode).
 */
export function usePlayback(active: boolean) {
  const [t, setTState] = useState(1);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(1);
  const setT = (x: number) => {
    tRef.current = x;
    setTState(x);
  };
  useEffect(() => {
    if (active) return;
    setPlaying(false);
    setT(1);
  }, [active]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const next = advance(tRef.current, now - last);
      last = now;
      setT(next);
      if (next >= 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return {
    t,
    playing,
    play: () => {
      setT(startPlay(tRef.current));
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    scrub: (x: number) => {
      setPlaying(false);
      setT(Math.min(1, Math.max(0, x)));
    },
  };
}
export type Playback = ReturnType<typeof usePlayback>;

/** Plot mode's sidebar: the time and where it goes, pass order, the animation, and output. */
export function PlotPanel(props: {
  recipe: Recipe;
  registry: StepRegistry;
  steps: StepInfo[];
  /** The run's plot (every pen, in pass order). */
  plot: Plot | null;
  /** What the canvas plays: the plot, or one pen of it. */
  shown: Plot | null;
  estimate: PlotEstimate | null;
  busy: boolean;
  playback: Playback;
  /** False while a plotter target has no lines to plot yet. */
  canExport: boolean;
  exporting: ExportFormat | null;
  onExport: (f: ExportFormat) => void;
  onSend: () => void;
  /** A new pass order (layer ids), or back to light → dark. */
  onPassOrder: (order: string[] | "light-to-dark") => void;
  onDownloadRecipe: () => void;
  onCopyCli: () => void;
}) {
  const { recipe: r, plot, estimate: e, playback: pb } = props;
  const plotter = r.target.kind === "plotter";
  const send = sendState(r.target, !!plot && plot.layers.some((l) => l.paths.length > 0));
  const formats = outputFormats(r.target);
  const lines = !!props.shown?.layers.some((l) => l.paths.length > 0);

  return (
    <div className="plot-panel">
      <section className="panel-sec plot-time">
        <h3>Time</h3>
        {!plotter ? (
          <p className="hint">Plot time is for the Plotter target. This target makes files, so there is no plot time.</p>
        ) : e && plot ? (
          <>
            <div className="bigtime" title="Estimated from the machine profile, pen changes included.">
              ~{fmtTime(e.totalS)}
            </div>
            <div className="breakdown">
              {timeRows(plot, e).map((row) => (
                <div key={row.key} className="row" data-part={row.key}>
                  <span>
                    {row.label} <span className="detail">{row.detail}</span>
                  </span>
                  <span>{fmtTime(row.seconds)}</span>
                </div>
              ))}
            </div>
            {!plot.ordered && <p className="hint">Traced order: add Stroke order in Design for a shorter, more accurate time.</p>}
          </>
        ) : (
          <p className="hint">{props.busy ? "Working out the time…" : "No time estimate yet: the recipe has no lines to plot."}</p>
        )}
      </section>

      {plotter && plot && plot.layers.length > 1 && (
        <section className="panel-sec">
          <h3>Pass order</h3>
          <p className="hint">Each pen is one pass, with a pen change between passes. Light inks usually go first.</p>
          <ol className="pass-order">
            {plot.layers.map((l, i) => {
              const up = movePass(plot, i, -1);
              const down = movePass(plot, i, 1);
              return (
                <li key={l.id} className="param-row pass" data-pass={l.id}>
                  <span className="num">{i + 1}</span>
                  <span className="swatch" style={{ background: l.ink.color }} />
                  <span className="layer-name">{l.name}</span>
                  <button className="icon" disabled={!up} aria-label={`Plot ${l.name} earlier`} onClick={() => up && props.onPassOrder(up)}>
                    ↑
                  </button>
                  <button className="icon" disabled={!down} aria-label={`Plot ${l.name} later`} onClick={() => down && props.onPassOrder(down)}>
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
          {Array.isArray(r.passOrder) && (
            <button onClick={() => props.onPassOrder("light-to-dark")} title="Plot the lightest ink first, the darkest last">
              Light → dark
            </button>
          )}
        </section>
      )}

      {props.shown && lines && (
        <section className="panel-sec">
          <h3>Watch it plot</h3>
          <div className="play-row">
            <button className="primary play" onClick={pb.playing ? pb.pause : pb.play}>
              {pb.playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              className="scrub"
              min={0}
              max={1000}
              step={1}
              value={Math.round(pb.t * 1000)}
              aria-label="Plot progress"
              onChange={(ev) => pb.scrub(Number(ev.target.value) / 1000)}
            />
          </div>
          <p className="hint play-where" aria-live="off">
            {frameLabel(props.shown, pb.t)}
          </p>
        </section>
      )}

      <section className="panel-sec">
        <h3>Output</h3>
        <div className="actions">
          <button className={plotter ? "primary send" : "send"} disabled={!send.ok || props.exporting !== null} onClick={props.onSend} title={send.ok ? "Save the plotter file to open in your plotter's software" : send.reason}>
            Send to plotter
          </button>
          {!send.ok && <p className="hint send-why">{send.reason}</p>}
          {formats.map((f, i) => (
            <button key={f} className={!plotter && i === 0 ? "primary" : ""} data-format={f} disabled={props.exporting !== null || !props.canExport} onClick={() => props.onExport(f)}>
              {props.exporting === f ? "Exporting…" : `Download ${FORMAT_LABEL[f]}`}
            </button>
          ))}
          <button onClick={props.onDownloadRecipe}>Download recipe</button>
          <button onClick={props.onCopyCli}>Copy as CLI command</button>
        </div>
      </section>
      <details className="more panel-sec timings">
        <summary>Step timings</summary>
        {props.steps.map((t) => (
          <div key={t.index}>
            {props.registry.get(t.step)?.title ?? t.step}: {t.cached ? "cached" : `${t.ms.toFixed(0)} ms`}
          </div>
        ))}
      </details>
    </div>
  );
}

/**
 * Plot mode's strip: one box per pass (pen), in pass order, each with a picture of that pen's
 * lines. Clicking a box shows only that pen; clicking it again, or All pens, shows them all.
 */
export function PassStrip(props: {
  boxes: PassBox[];
  thumbs: Record<string, Blob>;
  solo: string | null;
  /** Thumbnail size in CSS px. */
  size: number;
  onSolo: (id: string | null) => void;
}) {
  const n = props.boxes.length;
  return (
    <section className="strip-wrap pass-strip" aria-label="Passes" style={{ "--thumb": `${props.size}px` } as CSSProperties}>
      <div className="strip-head">
        <strong>Passes</strong>
        <span className="strip-hint">
          {n} {n === 1 ? "pen" : "pens"} in plot order · click a pen to see only its lines
        </span>
        <button className={`all-pens${props.solo === null ? " on" : ""}`} aria-pressed={props.solo === null} onClick={() => props.onSolo(null)}>
          All pens
        </button>
      </div>
      <div className="strip">
        {props.boxes.map((b, i) => {
          const selected = props.solo === b.id;
          return (
            <div key={b.id} data-pass={b.id} className={`box${selected ? " sel" : ""}`} style={{ "--out": b.color } as CSSProperties} onClick={() => props.onSolo(b.id)}>
              <button className="pick" aria-pressed={selected} aria-label={selected ? `Show every pen again` : `Show only ${b.name}`} title={selected ? "Click again to show every pen" : `Show only ${b.name}'s lines`}>
                <span className="band same">Pass {i + 1}</span>
                <span className="pic">
                  <Thumb png={props.thumbs[b.id]} />
                </span>
                <span className="lbl">
                  <span className="swatch" style={{ background: b.color }} />
                  <span className="name">{b.name}</span>
                </span>
                <span className="box-note">
                  {b.lines.toLocaleString("en-US")} {b.lines === 1 ? "line" : "lines"}
                  {b.timeS !== null && ` · ~${fmtTime(b.timeS)}`}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
