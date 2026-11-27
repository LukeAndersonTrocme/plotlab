import { lanesOf, type Plot, type Recipe, type StepRegistry } from "@plotlab/engine";
import { laneOrder } from "./lanes.ts";
import { stripLanes } from "./strip.ts";
import { selectedIndex, type ViewState } from "./view.ts";

/**
 * CMYK views (#66): how the canvas shows a split picture's inks. Stacked (all the inks on one
 * paper) or four panels (C, M, Y, K, each on its own paper); one ink's step with the other inks
 * faintly underneath; and the inks see-through (multiply) or opaque, drawn in pass order so a
 * later ink covers an earlier one. Only the view: the same stage output the canvas already has,
 * drawn differently, never a recipe edit or a change to the export. Pure, tested without a browser.
 *
 * The lanes are a view of one chain (ADR 0009), so every ink's state at a step is in that step's
 * output: four panels at a step show each ink as it is right after that step in the chain (its
 * own steps up to there have run, steps further on haven't). In Linked mode that is every ink at
 * that step; in Independent mode it is each lane's output at the same place in the chain.
 */

/** Where the four panels are: the split step, a step after it, or the final stack (the result). */
export type InkPoint = "split" | "step" | "stack";

export interface InkPanel {
  id: string;
  name: string;
  /** Hidden in the Stack panel: the panel stays, empty, so the four keep their places. */
  hidden: boolean;
  /** The ink the selected step was picked in (an independent lane). */
  current: boolean;
}

export interface InkCanvas {
  /** The inks in pass order (lane order), for opaque inks. */
  order: string[];
  /** Where four panels show; null before the split (the source, steps before it): no inks yet. */
  point: InkPoint | null;
  /** The four panels, in the split's order; null when stacked (or before the split). */
  panels: InkPanel[] | null;
  /** Stacked, looking at one ink's step (an independent lane): that ink on top. */
  focus: string | null;
  /** With a focus: the other inks faintly underneath, or left out. */
  otherInks: boolean;
  opaque: boolean;
}

/** The CMYK views for this view and recipe; null when they don't apply (not split, not Design, or comparing). */
export function inkCanvas(v: ViewState, recipe: Recipe, registry: StepRegistry, plot: Plot | null, hidden: ReadonlySet<string>): InkCanvas | null {
  if (v.mode !== "design" || v.compare) return null;
  const strip = stripLanes(recipe, registry);
  if (!strip) return null;
  const lanes = lanesOf(recipe, registry);
  const split = lanes.split!;
  const at = selectedIndex(v, recipe);
  const point: InkPoint | null = v.selection.kind === "result" ? "stack" : at === split ? "split" : at > split ? "step" : null;
  // The ink this step was picked in, while that lane is independent and still has the step.
  const lane = v.lane !== null && point === "step" ? lanes.lanes.find((l) => l.layer === v.lane) : undefined;
  const picked = lane && !lane.linked && lane.steps.some((s) => s.index === at) ? lane.layer : null;
  const four = v.inkPanels === "four" && point !== null;
  return {
    order: laneOrder(strip.layers, plot, recipe.passOrder),
    point,
    panels: four ? strip.layers.map((id, i) => ({ id, name: strip.names[i] ?? id, hidden: hidden.has(id), current: id === picked })) : null,
    focus: four ? null : picked,
    otherInks: v.otherInks,
    opaque: v.inkMix === "opaque",
  };
}

/** One thing the canvas draws: a raster (image or layer) or one ink's lines. */
export interface DrawItem {
  kind: "raster" | "lines";
  id: string;
  /** Context: another ink, drawn faintly under the one being looked at. */
  faint: boolean;
  mix: "multiply" | "normal";
}

export interface DrawOptions {
  hidden: ReadonlySet<string>;
  /** One ink's step: that ink on top, the others faint (`otherInks`) or left out. */
  focus?: string | null;
  otherInks?: boolean;
  /** Opaque inks: ink by ink in `order` (pass order), normal blending, so later covers earlier. */
  opaque?: boolean;
  order?: string[];
}

/**
 * What the canvas draws, bottom to top. Images (`color` null) first; hidden inks never. By
 * default the layers then the lines, as they come, each with its own mix (see-through inks
 * multiply, so their order doesn't change the picture). Opaque: each ink's layer then its
 * lines, in pass order, blended normally. With a focus, the other inks go underneath, faint.
 */
export function drawOrder(rasters: ReadonlyArray<{ id: string; color: string | null; mix: "multiply" | "normal" }>, lines: ReadonlyArray<{ id: string; mix: "multiply" | "normal" }>, o: DrawOptions): DrawItem[] {
  const images: DrawItem[] = rasters.filter((r) => r.color === null && !o.hidden.has(r.id)).map((r) => ({ kind: "raster", id: r.id, faint: false, mix: r.mix }));
  let inks: DrawItem[] = [
    ...rasters.filter((r) => r.color !== null).map((r): DrawItem => ({ kind: "raster", id: r.id, faint: false, mix: r.mix })),
    ...lines.map((l): DrawItem => ({ kind: "lines", id: l.id, faint: false, mix: l.mix })),
  ].filter((d) => !o.hidden.has(d.id));
  if (o.opaque) {
    const order = o.order ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    // A stable sort: one ink's layer stays under its lines, and unknown ids keep their order.
    inks = inks.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d.id) - rank(b.d.id) || a.i - b.i).map(({ d }) => ({ ...d, mix: "normal" }));
  }
  if (o.focus) {
    const others = o.otherInks ? inks.filter((d) => d.id !== o.focus).map((d) => ({ ...d, faint: true })) : [];
    inks = [...others, ...inks.filter((d) => d.id === o.focus)];
  }
  return [...images, ...inks];
}
