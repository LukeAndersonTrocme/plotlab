import { exportFormats, FORMAT_LABEL, type ExportFormat, type Recipe } from "@plotlab/engine";
import type { StepRegistry } from "@plotlab/engine";
import type { StepInfo } from "./protocol.ts";

/** Plot mode, for now: the files to download and the step timings. */
export function PlotPanel(props: {
  recipe: Recipe;
  registry: StepRegistry;
  steps: StepInfo[];
  /** False while a plotter target has no lines to plot yet. */
  canExport: boolean;
  exporting: ExportFormat | null;
  onExport: (f: ExportFormat) => void;
  onDownloadRecipe: () => void;
  onCopyCli: () => void;
}) {
  return (
    <div className="plot-panel">
      <section className="panel-sec">
        <h3>Output</h3>
        <div className="actions">
          {exportFormats(props.recipe.target).map((f, i) => (
            <button key={f} className={i === 0 ? "primary" : ""} disabled={props.exporting !== null || !props.canExport} onClick={() => props.onExport(f)}>
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
