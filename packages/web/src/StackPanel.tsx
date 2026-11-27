import type { PassOrder, Plot } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import { stackRows } from "./lanes.ts";
import { movePass } from "./plotmode.ts";
import { fmtTime } from "./setup.ts";
import type { InkMix } from "./view.ts";

/**
 * The Stack panel (#66): where the lanes merge into one plot. Each ink in pass order (the lane
 * order), with its lines and plotting time; ↑ / ↓ change the pass order (Plot mode's
 * `movePass`, a recipe edit), and Show hides an ink from the canvas to judge the others alone
 * (only the view: the export keeps every ink). See-through / Opaque changes how the canvas
 * mixes the inks (`inkview.ts`), so the pass order's effect shows.
 */
export function StackPanel(props: {
  layers: string[];
  names: string[];
  plot: Plot | null;
  estimate: PlotEstimate | null;
  passOrder: PassOrder;
  hidden: ReadonlySet<string>;
  onHide: (id: string, hide: boolean) => void;
  onPassOrder: (order: string[]) => void;
  /** How the canvas mixes the inks (only the view: the export is unchanged). */
  mix: InkMix;
  onMix: (mix: InkMix) => void;
}) {
  const rows = stackRows(props.layers, props.names, props.plot, props.estimate, props.passOrder);
  const plot = props.plot;
  return (
    <div className="card stack-panel" aria-label="Stack: all the inks together">
      <div className="card-head">
        <strong>Stack</strong>
        <span className="hint">All the inks together, in plotting order.</span>
      </div>
      <ol className="stack-rows">
        {rows.map((r) => {
          const up = plot && r.pass >= 0 ? movePass(plot, props.passOrder, r.pass, -1) : null;
          const down = plot && r.pass >= 0 ? movePass(plot, props.passOrder, r.pass, 1) : null;
          const shown = !props.hidden.has(r.id);
          return (
            <li key={r.id} className={`param-row stack-row${shown ? "" : " hidden-ink"}`} data-ink={r.id}>
              <span className="num">{r.pass >= 0 ? r.pass + 1 : "–"}</span>
              <span className={`ink-dot ink-${r.id}`} aria-hidden="true" />
              <span className="layer-name">{r.name}</span>
              <span className="stack-stat">{r.pass >= 0 ? `${r.lines.toLocaleString("en-US")} ${r.lines === 1 ? "line" : "lines"}${r.timeS !== null ? ` · ~${fmtTime(r.timeS)}` : ""}` : "not lines yet"}</span>
              <button className="icon" disabled={!up} aria-label={`Plot ${r.name} earlier`} title={`Plot ${r.name} earlier`} onClick={() => up && props.onPassOrder(up)}>
                ↑
              </button>
              <button className="icon" disabled={!down} aria-label={`Plot ${r.name} later`} title={`Plot ${r.name} later`} onClick={() => down && props.onPassOrder(down)}>
                ↓
              </button>
              <label className="chip" title={shown ? `Hide ${r.name} on the canvas to judge the other inks alone (the export keeps it)` : `Show ${r.name} again`}>
                <input type="checkbox" checked={shown} onChange={(e) => props.onHide(r.id, !e.target.checked)} /> Show
              </label>
            </li>
          );
        })}
      </ol>
      <div className="stack-mix">
        <span className="seg" role="group" aria-label="Inks on the canvas">
          <button aria-pressed={props.mix === "see-through"} onClick={() => props.onMix("see-through")} title="Inks mix where they cross, like transparent ink">
            See-through
          </button>
          <button aria-pressed={props.mix === "opaque"} onClick={() => props.onMix("opaque")} title="Each ink covers the ones plotted before it">
            Opaque
          </button>
        </span>
        <span className="hint">With opaque inks the last ink plotted covers the others where they cross, so the order changes the picture. Only the preview: the export is unchanged.</span>
      </div>
    </div>
  );
}
