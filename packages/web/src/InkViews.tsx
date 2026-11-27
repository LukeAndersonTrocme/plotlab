import type { Paper, Plot } from "@plotlab/engine";
import type { InkCanvas, InkPanel } from "./inkview.ts";
import type { RasterView } from "./protocol.ts";
import { StageLayers } from "./StageView.tsx";
import { setInkPanels, setOtherInks, type ViewState } from "./view.ts";

/**
 * The CMYK view controls above the canvas (#66), while the picture is split: Stacked / Four
 * panels, and Show other inks when looking at one ink's step. Only the view.
 */
export function InkViewBar(props: { canvas: InkCanvas; view: ViewState; onView: (v: ViewState) => void }) {
  const { canvas: c, view: v } = props;
  const four = v.inkPanels === "four";
  return (
    <span className="ink-view-bar">
      <span className="seg" role="group" aria-label="How the inks show">
        <button aria-pressed={!four || c.point === null} onClick={() => props.onView(setInkPanels(v, "stacked"))} title="All the inks together on one paper">
          Stacked
        </button>
        <button
          aria-pressed={four && c.point !== null}
          disabled={c.point === null}
          onClick={() => props.onView(setInkPanels(v, "four"))}
          title={c.point === null ? "Four panels start at the split: before it there is one picture, not four inks" : "C, M, Y and K side by side, each on its own paper"}
        >
          Four panels
        </button>
      </span>
      {c.focus !== null && (
        <button className="toggle-btn" aria-pressed={c.otherInks} onClick={() => props.onView(setOtherInks(v, !c.otherInks))} title="Show the other inks faintly underneath this one">
          Show other inks
        </button>
      )}
    </span>
  );
}

/** What the four panels show, in words for the view bar. */
export const panelsTitle = (c: InkCanvas, step: string) => (c.point === "split" ? "each ink at the split" : c.point === "stack" ? "each ink in the final stack" : `each ink after ${step}`);

/** Space between the panels, in mm of paper. */
const GAP = 8;

/**
 * Four panels: C, M, Y and K side by side (2×2, like the lane thumbnails), each ink alone on
 * its own paper, from the same stage output as the stacked canvas. A hidden ink keeps its
 * panel, empty; the ink the step was picked in is outlined.
 */
export function FourPanels(props: { paper: Paper; panels: InkPanel[]; rasters: RasterView[]; plot: Plot | null; hidden: ReadonlySet<string>; showTravel: boolean; underlay: RasterView | null; empty?: string }) {
  const { widthMm: w, heightMm: h } = props.paper;
  const label = Math.max(4, Math.min(w, h) / 16);
  const nothing = !props.rasters.length && !props.plot;
  return (
    <svg className="preview four-panels" viewBox={`-5 -5 ${2 * w + GAP + 10} ${2 * h + GAP + 10}`} preserveAspectRatio="xMidYMid meet" aria-label="Four panels: each ink on its own paper">
      {props.panels.map((p, k) => (
        <g key={p.id} className={`ink-panel${p.current ? " current" : ""}`} data-panel={p.id} data-hidden={p.hidden || undefined} transform={`translate(${(k % 2) * (w + GAP)} ${Math.floor(k / 2) * (h + GAP)})`}>
          <rect x={0} y={0} width={w} height={h} className="paper" />
          {!p.hidden && <StageLayers rasters={props.rasters} plot={props.plot} showTravel={props.showTravel} underlay={props.underlay} hidden={props.hidden} inks={{ focus: p.id, otherInks: false }} />}
          {p.current && <rect x={0} y={0} width={w} height={h} className="panel-current" />}
          <text x={label * 0.6} y={label * 1.4} className={`panel-label ink-text-${p.id}`} style={{ fontSize: label }}>
            {p.name}
          </text>
          {!p.hidden && nothing && props.empty && (
            <text x={w / 2} y={h / 2} textAnchor="middle" className="empty-text" style={{ fontSize: label }}>
              {props.empty}
            </text>
          )}
          {p.hidden && (
            <text x={w / 2} y={h / 2} textAnchor="middle" className="empty-text" style={{ fontSize: label }}>
              Hidden (Stack panel)
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
