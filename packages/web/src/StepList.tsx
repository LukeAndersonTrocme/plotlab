import { useState } from "react";
import {
  isChanged,
  isVisible,
  moveStep,
  removeStep,
  resetParam,
  resetAllInks,
  resetLaneStep,
  resetStep,
  setLaneParam,
  validated,
  type AnyStep,
  type LayerInfo,
  type ParamDecl,
  type Recipe,
  type RecipeStep,
  type StageKind,
  type StepRegistry,
} from "@plotlab/engine";
import { LayerScope } from "./LayerScope.tsx";
import { ParamControl } from "./ParamControl.tsx";
import { splitSettings } from "./settings.ts";
import type { InspectTarget, StepInfo } from "./protocol.ts";
import { bypassRule, removeCheck, STAGE_NAMES, toggleBypass } from "./strip.ts";
import { allInks, unlinkedNotice } from "./lanes.ts";

/** Which cards the sidebar shows, by chain position (from `sidebarSteps` in view.ts). */
export interface SidebarCards {
  /** The step being looked at, on top with its actions; null for the source. */
  looking: number | null;
  /** The other pinned steps, in recipe order. */
  pinned: number[];
  lookingPinned: boolean;
}

/**
 * The chain as one ordered list (ADR 0009): stage dividers where the data type changes,
 * drag (or ↑/↓) to reorder within the type rules, remove, disable. Steps are added with the
 * strip's "+" (Strip.tsx), which offers only the steps that fit at that point.
 * With `cards`, the sidebar's working view instead: the step being looked at (with Switch
 * off, Branch from here and Remove), then the pinned steps and a place to drop more.
 */
export function StepList(props: {
  recipe: Recipe;
  /** Show these cards instead of every step. */
  cards?: SidebarCards;
  /** Ids of the pinned steps. */
  pins: readonly string[];
  onPin: (id: string) => void;
  /** Save a checkpoint before trying something else from this step on; null when checkpoints are off. */
  onBranch: ((index: number) => void) | null;
  registry: StepRegistry;
  steps: StepInfo[];
  stale: number[];
  error: { message: string; index?: number } | null;
  inspect: InspectTarget;
  onInspect: (t: InspectTarget) => void;
  onChange: (r: Recipe, proxy: boolean, step?: AnyStep) => void;
  onRun: () => void;
  onHelp: (def: AnyStep) => void;
  onNotice: (msg: string) => void;
  /**
   * Independent inks: the step being looked at was picked in this ink's lane, so its card
   * shows and edits that ink's settings (`setLaneParam`) and can take the step out of the lane.
   */
  lane?: { layer: string; name: string } | null;
  onRemoveFromLane?: (index: number, layer: string) => void;
}) {
  const { recipe, registry } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [editing, setEditing] = useState<Record<number, string | null>>({});

  /** Apply an edit; when it turns linked inks independent, say so (as Independent does). */
  const change = (next: Recipe, proxy: boolean, step?: AnyStep) => {
    props.onChange(next, proxy, step);
    // Said at the first change that unlinks them (a drag's preview already does).
    const note = unlinkedNotice(recipe, next, registry);
    if (note) props.onNotice(note);
  };
  const commit = (res: { recipe: Recipe } | { reason: string }) => {
    if ("reason" in res) props.onNotice(res.reason);
    else change(res.recipe, false);
  };
  const patchStep = (index: number, patch: Partial<RecipeStep>, proxy: boolean) => {
    const steps = recipe.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    const def = registry.get(recipe.steps[index]!.step);
    // Which inks a step applies to goes through the chain rules, like moving it: the chain and
    // every ink's lane must still work.
    if ("layers" in patch) {
      const res = validated(recipe, steps, registry, `${def?.title ?? "This step"} can't apply to just those: `);
      if ("reason" in res) return props.onNotice(res.reason);
    }
    change({ ...recipe, steps }, proxy, def);
  };
  /** The lane the card at `index` edits: only the card being looked at, picked in a lane. */
  const laneAt = (index: number) => (props.lane && props.cards?.looking === index ? props.lane : null);
  const setParam = (index: number, name: string, value: unknown, proxy: boolean) => {
    const rs = recipe.steps[index]!;
    const layer = editing[index] ?? null;
    if (layer === null) {
      // From a lane: that ink's settings when it's independent. Else a linked edit: the shared
      // settings, written once for every ink (lanes, #66).
      // With no lane, on independent inks: every ink (their own copies too).
      const res = setLaneParam(recipe, registry, rs.id, name, value, laneAt(index)?.layer ?? null);
      if ("reason" in res) props.onNotice(res.reason);
      else change(res.recipe, proxy, registry.get(rs.step));
    } else patchStep(index, { layerParams: { ...rs.layerParams, [layer]: { ...rs.layerParams?.[layer], [name]: value } } }, proxy);
  };
  /** Layers arriving at step `index`: the output of the last step before it that ran. */
  const inputLayers = (index: number): LayerInfo[] => [...props.steps].reverse().find((s) => s.index < index)?.layers ?? [];

  let kind: StageKind = recipe.input;
  const items: JSX.Element[] = [
    <div key="src" className={`divider${props.inspect === "source" ? " on" : ""}`} onClick={() => props.onInspect("source")}>
      Source{recipe.input !== "image" ? ` · enters as ${STAGE_NAMES[recipe.input].toLowerCase()}` : ""}
    </div>,
  ];
  recipe.steps.forEach((rs, index) => {
    const def = registry.get(rs.step);
    if (!def) return;
    const enabled = rs.enabled !== false;
    if (enabled && def.output !== kind) {
      kind = def.output as StageKind;
      items.push(
        <div key={`d${index}`} className="divider">
          {STAGE_NAMES[kind]}
        </div>,
      );
    }
    const layerStep = Boolean(def.runLayer);
    const lane = editing[index] == null ? laneAt(index) : null;
    const layer = editing[index] ?? lane?.layer ?? null;
    const values = layer === null ? rs.params : { ...rs.params, ...rs.layerParams?.[layer] };
    // In a lane every setting is the ink's own: changed means not the default.
    const changedHere = (name: string, decl: ParamDecl) =>
      lane ? isChanged(decl, values[name]) : layer === null ? isChanged(decl, rs.params[name]) : rs.layerParams?.[layer]?.[name] !== undefined;
    // No lane and no "Settings for" ink, on independent inks: the card edits every ink.
    const everyInk = !lane && editing[index] == null && allInks(recipe, registry, rs.id);
    const resetHere = (name: string) =>
      lane || everyInk
        ? setParam(index, name, (def.params[name] as ParamDecl).default, false)
        : props.onChange(resetParam(recipe, index, name, registry, layer ?? undefined), false);
    const stepChanged =
      Object.keys(rs.layerParams ?? {}).length > 0 || Object.entries(def.params).some(([n, d]) => isChanged(d as ParamDecl, rs.params[n]));
    const stale = props.stale.includes(index);
    const ran = props.steps.some((s) => s.index === index);
    const pinned = props.pins.includes(rs.id);
    const focused = props.cards?.looking === index;
    const bypass = bypassRule(recipe, index, registry); // the strip toggle's rule too
    const remove = removeCheck(recipe, index, registry);
    items.push(
      <div
        key={`s${index}`}
        data-step={rs.id}
        className={[
          "card step",
          enabled ? "" : "disabled",
          props.error?.index === index ? "has-error" : "",
          props.inspect === index ? "inspected" : "",
          focused ? "focus" : "",
          dragFrom === index ? "dragging" : "",
        ].join(" ")}
        onDragOver={(e) => dragFrom !== null && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragFrom !== null && dragFrom !== index) commit(moveStep(recipe, dragFrom, index, registry));
          setDragFrom(null);
        }}
      >
        <div className="card-head">
          <span
            className="handle"
            draggable
            title="Drag to reorder"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragFrom(index);
            }}
            onDragEnd={() => setDragFrom(null)}
          >
            ⠿
          </span>
          <button className="title link" title="Show this step's output" onClick={() => props.onInspect(index)}>
            {def.title}
          </button>
          {def.experimental && (
            <span className="badge experimental" title="Experimental: settings may change in a later version. Old recipes still load, with a warning.">
              experimental
            </span>
          )}
          <span className="card-tools">
            <button className="icon" aria-label={`Move ${def.title} up`} disabled={index === 0} onClick={() => commit(moveStep(recipe, index, index - 1, registry))}>
              ↑
            </button>
            <button
              className="icon"
              aria-label={`Move ${def.title} down`}
              disabled={index === recipe.steps.length - 1}
              onClick={() => commit(moveStep(recipe, index, index + 1, registry))}
            >
              ↓
            </button>
            {!focused && (
              <input
                type="checkbox"
                aria-label={`${enabled ? "Switch off" : "Switch on"} ${def.title}`}
                title={bypass.ok ? (enabled ? "On (untick to switch this step off)" : "Switched off") : bypass.reason}
                checked={enabled}
                disabled={!bypass.ok}
                onChange={() => commit(toggleBypass(recipe, index, registry))}
              />
            )}
            {stepChanged && (
              <button
                className="icon"
                title={lane ? `Defaults for this step, for ${lane.name} only: put its settings back (keeps the seed); the other inks keep theirs` : everyInk ? "Defaults for this step, for every ink: put each ink's settings back (keeps the seed); the inks stay independent" : "Defaults for this step: put every setting back (keeps the seed)"}
                aria-label={`Defaults for ${def.title}`}
                onClick={() =>
                  lane ? commit(resetLaneStep(recipe, registry, rs.id, lane.layer)) : everyInk ? commit(resetAllInks(recipe, registry, rs.id)) : props.onChange(resetStep(recipe, index, registry), false)
                }
              >
                ↺
              </button>
            )}
            <button className="help-btn" onClick={() => props.onHelp(def)} aria-label={`Help for ${def.title}`}>
              ?
            </button>
            <button
              className="pin-btn"
              aria-pressed={pinned}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${def.title}`}
              title={pinned ? "Unpin: stop keeping these settings in the sidebar" : "Pin: keep these settings in the sidebar while you look at other steps"}
              onClick={() => props.onPin(rs.id)}
            >
              {pinned ? "Pinned" : "Pin"}
            </button>
            {!focused && (
              <button
                className="icon"
                aria-label={`Remove ${def.title}`}
                disabled={!remove.ok}
                title={remove.ok ? `Remove ${def.title}` : remove.reason}
                onClick={() => commit(removeStep(recipe, index, registry))}
              >
                ✕
              </button>
            )}
          </span>
        </div>
        <p className="summary">{def.summary}</p>
        {focused && (
          <>
            <div className="step-actions">
              <button
                disabled={!bypass.ok}
                title={bypass.ok ? (enabled ? "Skip this step and see what the chain does without it" : "Put this step back in the chain") : bypass.reason}
                onClick={() => commit(toggleBypass(recipe, index, registry))}
              >
                {enabled ? "Switch off" : "Switch on"}
              </button>
              <button
                disabled={!props.onBranch}
                title={props.onBranch ? "Save this version as a checkpoint, then try something else from this step on" : "Checkpoints are off for this image"}
                onClick={() => props.onBranch?.(index)}
              >
                Branch from here
              </button>
              <button disabled={!remove.ok} title={remove.ok ? `Take ${def.title} out of the recipe${lane ? ", for every ink" : ""} (Back undoes it)` : remove.reason} onClick={() => commit(removeStep(recipe, index, registry))}>
                Remove
              </button>
              {lane && props.onRemoveFromLane && (
                <button title={`Take ${def.title} out of the ${lane.name} lane only: the other inks keep it`} onClick={() => props.onRemoveFromLane!(index, lane.layer)}>
                  Take out of {lane.name}
                </button>
              )}
            </div>
            {lane && !layerStep && <p className="hint lane-note">Settings for {lane.name} only.</p>}
            {!remove.ok && <p className="reason">{remove.reason}</p>}
          </>
        )}
        {enabled && layerStep && (
          <LayerScope
            step={rs}
            available={inputLayers(index)}
            editing={layer}
            onEditing={(l) => setEditing({ ...editing, [index]: l })}
            onChange={(patch) => patchStep(index, patch, false)}
          />
        )}
        {enabled && everyInk && <p className="hint all-inks-note">Settings for all inks: each ink's own settings change together. To change one ink, pick its box in a lane.</p>}
        {enabled && (() => {
          const control = (name: string) =>
            isVisible(def.params, name, values) ? (
              <ParamControl
                key={name}
                name={name}
                decl={def.params[name] as ParamDecl}
                value={values[name]}
                onDrag={(v) => setParam(index, name, v, true)}
                onCommit={(v) => setParam(index, name, v, false)}
                changed={changedHere(name, def.params[name] as ParamDecl)}
                onReset={() => resetHere(name)}
              />
            ) : null;
          const { main, more } = splitSettings(def.params);
          const shownMore = more.filter((n) => isVisible(def.params, n, values));
          return (
            <>
              {main.map(control)}
              {shownMore.length > 0 && (
                <details className="more">
                  <summary>
                    More settings ({shownMore.length})
                    {shownMore.some((n) => changedHere(n, def.params[n] as ParamDecl)) && <span className="changed-dot more-changed" title="Some of these are changed" />}
                  </summary>
                  {shownMore.map(control)}
                </details>
              )}
            </>
          );
        })()}
        {enabled && def.cost === "on-demand" && (stale || !ran) && (
          <div className="run-row">
            <button className="primary" onClick={props.onRun}>
              Run {def.title.toLowerCase()}
            </button>
            <span className="hint">Takes a moment on big drawings, so it runs when you ask.</span>
          </div>
        )}
        {props.error?.index === index && <div className="error">{props.error.message}</div>}
      </div>,
    );
  });

  const c = props.cards;
  if (c) {
    const card = (i: number) => items.find((el) => el.key === `s${i}`);
    const lookingTitle = c.looking !== null ? (registry.get(recipe.steps[c.looking]?.step ?? "")?.title ?? "This step") : "";
    const count = c.pinned.length + (c.lookingPinned ? 1 : 0);
    return (
      <div className="steps">
        {c.looking !== null && card(c.looking)}
        <div className="side-label pinned-label">
          Pinned{count > 0 && <span className="num">{count}</span>}
        </div>
        {c.lookingPinned && <p className="hint">{lookingTitle} is pinned too; its settings are at the top.</p>}
        {c.pinned.map(card)}
        <div className="pin-drop">
          {c.pinned.length || c.lookingPinned
            ? "Drop another box from the strip here to pin it."
            : "Pin steps to keep their settings here while you look at other steps: press Pin on a step, or drag its box from the strip onto this panel."}
        </div>
      </div>
    );
  }

  return (
    <div className="steps">
      {items}
      <p className="hint add-hint">To add a step, use a + between the boxes in the recipe strip below.</p>
    </div>
  );
}
