import { addInLane, lanesOf, moveInLane, removeFromLane, unlinkLanes, type ChainResult, type Plot, type Recipe, type StepRegistry } from "@plotlab/engine";
import { laneKey, laneOrder, laneRows, moveLane, type LaneRow } from "./lanes.ts";
import { linkWarning } from "./split.ts";
import { stripLanes, type StripLanes } from "./strip.ts";
import { clickLaneBox, RESULT, select, selectedIndex, showLanes, type ViewState } from "./view.ts";

/** What the lane wiring needs from the editor. */
export interface LaneDeps {
  recipe: Recipe;
  registry: StepRegistry;
  run: Parameters<typeof laneRows>[2];
  plot: Plot | null;
  view: ViewState;
  /** The latest view (handlers run after renders). */
  currentView: () => ViewState;
  changeView: (v: ViewState) => void;
  apply: (r: Recipe, proxy: boolean) => void;
  /** Apply, then look at step `id` in lane `lane`. */
  applySelecting: (r: Recipe, id: string, lane?: string) => void;
  setNotice: (msg: string) => void;
  /** Link onto a lane (saves a checkpoint first: `linkInks`). */
  link: (layer: string) => void;
}

/**
 * The CMYK lane props for the strip and the sidebar (#66), worked out from the recipe and the
 * view: lane rows for Independent inks, which ink the sidebar edits, and the lane edits (each
 * a recipe edit, or a reason shown to the person). Keeps this out of App.
 */
export function laneProps(d: LaneDeps): {
  lanes: StripLanes | null;
  strip: {
    laneRows: LaneRow[] | null;
    laneView: "all" | string;
    onShowLanes: (which: "all" | string) => void;
    selectedLane: string | null;
    onLaneSelect: (id: string, layer: string) => void;
    onLaneAdd: (layer: string, at: number, stepId: string) => void;
    onLaneMove: (id: string, layer: string, to: number) => void;
    onMoveLane: (from: number, to: number) => void;
    onUnlink: () => void;
    onLink: (layer: string) => void;
    linkWarning: (layer: string) => string;
    linkLane: string;
  };
  sidebar: { lane: { layer: string; name: string } | null; onRemoveFromLane: (index: number, layer: string) => void };
} {
  const { recipe, registry, view, plot } = d;
  const lanes = stripLanes(recipe, registry);
  const rows = lanes && !lanes.linked ? laneRows(recipe, registry, d.run, plot, view.laneView) : null;
  const selected = selectedIndex(view, recipe);
  // The ink whose settings the sidebar edits: the lane the selected step was picked in, while that lane is independent.
  const picked = view.lane && selected >= 0 && rows ? lanesOf(recipe, registry).lanes.find((x) => x.layer === view.lane) : undefined;
  const lane = picked && !picked.linked && picked.steps.some((x) => x.index === selected) ? { layer: picked.layer, name: lanes!.names[lanes!.layers.indexOf(picked.layer)] ?? picked.layer } : null;
  const edit = (res: ChainResult, then: (r: Recipe) => void) => ("reason" in res ? d.setNotice(res.reason) : then(res.recipe));
  return {
    lanes,
    strip: {
      laneRows: rows,
      laneView: view.laneView,
      onShowLanes: (w) => d.changeView(showLanes(d.currentView(), w)),
      selectedLane: view.selection.kind === "step" && view.lane ? laneKey(view.selection.id, view.lane) : null,
      onLaneSelect: (id, layer) => d.changeView(clickLaneBox(d.currentView(), id, layer)),
      onLaneAdd: (layer, at, stepId) => {
        const res = addInLane(recipe, registry, layer, stepId, at);
        if ("reason" in res) d.setNotice(res.reason);
        else d.applySelecting(res.recipe, res.recipe.steps[res.index]!.id, layer);
      },
      onLaneMove: (id, layer, to) => edit(moveInLane(recipe, registry, id, layer, to), (r) => d.applySelecting(r, id, layer)),
      onMoveLane: (from, to) => {
        const res = moveLane(lanes?.layers ?? [], plot, recipe.passOrder, from, to);
        if ("reason" in res) d.setNotice(res.reason);
        else d.apply({ ...recipe, passOrder: res }, false);
      },
      onUnlink: () =>
        edit(unlinkLanes(recipe, registry), (r) => {
          d.apply(r, false);
          d.setNotice("Independent: each ink has its own copy of the steps and settings now. A + in a lane adds a step for that ink only; Linked puts them back together.");
        }),
      onLink: d.link,
      linkWarning: (layer) => linkWarning(recipe, registry, layer),
      linkLane: view.lane ?? (lanes ? laneOrder(lanes.layers, plot, recipe.passOrder)[0] : undefined) ?? "C",
    },
    sidebar: {
      lane,
      onRemoveFromLane: (i, layer) =>
        edit(removeFromLane(recipe, registry, recipe.steps[i]!.id, layer), (r) => {
          d.changeView(select(d.currentView(), RESULT));
          d.apply(r, false);
        }),
    },
  };
}
