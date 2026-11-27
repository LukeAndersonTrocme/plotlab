import { addInLane, inkName, lanesOf, laneIssues, moveInLane, type PassOrder, type Plot, type Recipe, type StageKind, type StepRegistry } from "@plotlab/engine";
import type { PlotEstimate } from "@plotlab/machines";
import type { AddMenu, AddOption } from "./gaps.ts";
import { movePass, orderedPasses, passBoxes } from "./plotmode.ts";
import { stepIcon, stripBoxes, type StripBox } from "./strip.ts";

/**
 * Independent inks in the strip (#66): one row of boxes per lane (or one lane, picked by its
 * tab), in pass order, and the Stack panel's rows. Pure, so the rules are tested without a
 * browser. The lanes are a view of one chain (`lanesOf`); the edits are the engine's lane edits.
 */

/** A step's box in one lane: its thumbnail and selection key. "@" can't be in a step id, so it can't clash. */
export const laneKey = (stepId: string, layer: string) => `${stepId}@${layer}`;

export function parseLaneKey(key: string): { id: string; layer: string } | null {
  const at = key.indexOf("@");
  return at > 0 ? { id: key.slice(0, at), layer: key.slice(at + 1) } : null;
}

/**
 * Lane order is the pass order: the plot's passes (`orderedPasses`), or the recipe's own order
 * before the plot has caught up. Inks without lines aren't passes, so they come last, in the split's order.
 */
export function laneOrder(layers: string[], plot: Plot | null, passOrder: PassOrder): string[] {
  const passes = plot ? orderedPasses(plot, passOrder).map((l) => l.id) : Array.isArray(passOrder) ? passOrder : [];
  const named = passes.filter((id) => layers.includes(id));
  return [...named, ...layers.filter((l) => !named.includes(l))];
}

/**
 * Drag the lane at place `from` (in `laneOrder`) to place `to`: the new `passOrder`, made by
 * Plot mode's `movePass` one step at a time. An ink without lines isn't a pass, so it can't move.
 */
export function moveLane(layers: string[], plot: Plot | null, passOrder: PassOrder, from: number, to: number): string[] | { reason: string } {
  const order = laneOrder(layers, plot, passOrder);
  const id = order[from];
  if (id === undefined) return { reason: "There is no such lane." };
  if (!plot?.layers.some((l) => l.id === id)) return { reason: `${id} has no lines yet, so it isn't plotted: there's no pass to move. Give its lane a line step first.` };
  if (from === to) return { reason: `${id} is already there.` };
  const passes = () => orderedPasses(plot, current).map((l) => l.id);
  let current: PassOrder = passOrder;
  const target = order[Math.max(0, Math.min(order.length - 1, to))]!;
  const j = passes().includes(target) ? passes().indexOf(target) : passes().length - 1;
  let i = passes().indexOf(id);
  while (i !== j) {
    const d = j > i ? 1 : -1;
    const next = movePass(plot, current, i, d);
    if (!next) break;
    current = next;
    i += d;
  }
  return Array.isArray(current) ? current : passes();
}

/** One ink in the Stack panel. */
export interface StackRow {
  id: string;
  name: string;
  color: string | null;
  lines: number;
  timeS: number | null;
  /** Its place in the pass order; -1 when it has no lines (not plotted). */
  pass: number;
}

/** The Stack panel: every ink in lane (pass) order, with its lines and time. */
export function stackRows(layers: string[], names: string[], plot: Plot | null, estimate: PlotEstimate | null, passOrder: PassOrder): StackRow[] {
  const passes = plot ? passBoxes({ ...plot, layers: orderedPasses(plot, passOrder) }, estimate) : [];
  return laneOrder(layers, plot, passOrder).map((id) => {
    const pass = passes.findIndex((p) => p.id === id);
    const p = passes[pass];
    return { id, name: names[layers.indexOf(id)] ?? id, color: p?.color ?? null, lines: p?.lines ?? 0, timeS: p?.timeS ?? null, pass };
  });
}

type Run = Parameters<typeof stripBoxes>[2];

/** The boxes of lane `layer`: each lane step's strip box, keyed by step and ink. */
export function laneBoxes(recipe: Recipe, registry: StepRegistry, run: Run, layer: string, boxes = stripBoxes(recipe, registry, run)): StripBox[] {
  const lane = lanesOf(recipe, registry).lanes.find((l) => l.layer === layer);
  if (!lane) return [];
  return lane.steps.map((s) => ({ ...boxes[s.index + 1]!, key: laneKey(s.id, layer), lane: "lane" as const }));
}

export interface LaneRow {
  layer: string;
  name: string;
  boxes: StripBox[];
}

/** The lane rows to show: all of them in pass order (`show` "all"), or the one ink picked. */
export function laneRows(recipe: Recipe, registry: StepRegistry, run: Run, plot: Plot | null, show: "all" | string): LaneRow[] {
  const v = lanesOf(recipe, registry);
  if (v.split === null) return [];
  const inks = registry.get(recipe.steps[v.split]!.step)?.layerInks ?? {};
  const order = laneOrder(v.layers, plot, recipe.passOrder).filter((l) => show === "all" || l === show);
  const boxes = stripBoxes(recipe, registry, run);
  return order.map((layer) => ({ layer, name: inks[layer]?.name ?? layer, boxes: laneBoxes(recipe, registry, run, layer, boxes) }));
}

/**
 * The chain positions the strip's own row leaves out: with Independent inks the lane steps are
 * in the lane rows instead (the split and the stack stay in the row). Empty otherwise.
 */
export function stripHidden(recipe: Recipe, registry: StepRegistry): Set<number> {
  const v = lanesOf(recipe, registry);
  if (v.split === null || v.linked) return new Set();
  const merge = v.stack[0] ?? recipe.steps.length;
  const out = new Set<number>();
  for (let i = v.split + 1; i < merge; i++) out.add(i);
  return out;
}

/**
 * A keyboard move inside an Independent lane: step `stepId` one place along lane `layer`,
 * through the lane guard the drag uses (`moveInLane`), so a refusal has the drag's reason.
 * `to` is its new place in the lane.
 */
export function laneNudge(recipe: Recipe, registry: StepRegistry, stepId: string, layer: string, dir: -1 | 1): { recipe: Recipe; to: number } | { reason: string } {
  const v = lanesOf(recipe, registry);
  const lane = v.lanes.find((l) => l.layer === layer);
  const pos = lane?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (!lane || pos < 0) return { reason: `That step isn't in the ${inkName(recipe, registry, layer)} lane.` };
  const to = pos + dir;
  if (to < 0 || to >= lane.steps.length) {
    const s = lane.steps[pos]!;
    return { reason: `${registry.get(s.step)?.title ?? s.step} is already ${dir < 0 ? "first" : "last"} in the ${inkName(recipe, registry, layer)} lane.` };
  }
  const res = moveInLane(recipe, registry, stepId, layer, to);
  return "reason" in res ? res : { recipe: res.recipe, to };
}

/** What lane `layer` has at its gap `at`: layers until a line step there has made its lines. */
function laneStageAt(recipe: Recipe, registry: StepRegistry, layer: string, at: number): StageKind {
  const lane = lanesOf(recipe, registry).lanes.find((l) => l.layer === layer);
  let stage: StageKind = "layers";
  for (const s of lane?.steps.slice(0, at) ?? []) {
    const def = registry.get(s.step);
    if (s.enabled && def?.runLayer) stage = def.output as StageKind;
  }
  return stage;
}

/** The steps a lane's "+" offers: exactly those `addInLane` takes there, or why none fits. */
export function laneAddMenu(recipe: Recipe, registry: StepRegistry, layer: string, at: number): AddMenu {
  const stage = laneStageAt(recipe, registry, layer, at);
  const options: AddOption[] = registry
    .list()
    .filter((def) => "recipe" in addInLane(recipe, registry, layer, def.id, at))
    .map((def) => ({ id: def.id, title: def.title, icon: stepIcon(def.id), summary: def.summary, output: def.output as StageKind, experimental: Boolean(def.experimental), split: false }));
  if (options.length) return { stage, options, reason: null };
  const issue = laneIssues(recipe, registry)[0];
  return { stage, options, reason: issue ? `Nothing fits here until this lane fits together: ${issue.reason}` : `Nothing fits here in the ${layer} lane: no step that works on one ink keeps the steps after it working.` };
}

/**
 * A card that edits step `stepId` without a lane picked edits every ink (`setLaneParam` with no
 * lane, `resetAllInks`): true when the step is in the lanes and some ink has its own settings.
 */
export function allInks(recipe: Recipe, registry: StepRegistry, stepId: string): boolean {
  const rs = recipe.steps.find((s) => s.id === stepId);
  if (!rs || !Object.values(rs.layerParams ?? {}).some((o) => Object.keys(o).length)) return false;
  return lanesOf(recipe, registry).lanes.some((l) => l.steps.some((s) => s.id === stepId));
}

/** What to say when an edit turns linked inks independent (an ink's own setting or selector), else null. */
export function unlinkedNotice(before: Recipe, after: Recipe, registry: StepRegistry): string | null {
  const a = lanesOf(before, registry), b = lanesOf(after, registry);
  if (a.split === null || b.split === null || !a.linked || b.linked) return null;
  const inks = registry.get(after.steps[b.split]!.step)?.layerInks ?? {};
  const names = b.lanes.filter((l) => !l.linked).map((l) => inks[l.layer]?.name ?? l.layer);
  return `Independent: ${names.join(", ")} now ${names.length === 1 ? "has its" : "have their"} own steps or settings, so the inks aren't linked any more. A + in a lane adds a step for one ink only; Linked puts them back together.`;
}
