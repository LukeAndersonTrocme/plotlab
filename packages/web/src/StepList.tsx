import { useState } from "react";
import {
  checkChain,
  isChanged,
  isVisible,
  moveStep,
  removeStep,
  resetParam,
  resetStep,
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
import { STAGE_NAMES } from "./strip.ts";

/**
 * The chain as one ordered list (ADR 0009): stage dividers where the data type changes,
 * drag (or ↑/↓) to reorder within the type rules, remove, disable. Steps are added with the
 * strip's "+" (Strip.tsx), which offers only the steps that fit at that point.
 * With `only`, just that step's card: the step picked in the strip.
 */
export function StepList(props: {
  recipe: Recipe;
  /** Show only the step at this chain position. */
  only?: number;
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
}) {
  const { recipe, registry } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [editing, setEditing] = useState<Record<number, string | null>>({});

  const commit = (res: { recipe: Recipe } | { reason: string }) => {
    if ("reason" in res) props.onNotice(res.reason);
    else props.onChange(res.recipe, false);
  };
  const patchStep = (index: number, patch: Partial<RecipeStep>, proxy: boolean) => {
    const steps = recipe.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    props.onChange({ ...recipe, steps }, proxy, registry.get(recipe.steps[index]!.step));
  };
  const setParam = (index: number, name: string, value: unknown, proxy: boolean) => {
    const rs = recipe.steps[index]!;
    const layer = editing[index] ?? null;
    if (layer === null) patchStep(index, { params: { ...rs.params, [name]: value } }, proxy);
    else patchStep(index, { layerParams: { ...rs.layerParams, [layer]: { ...rs.layerParams?.[layer], [name]: value } } }, proxy);
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
    const layer = editing[index] ?? null;
    const values = layer === null ? rs.params : { ...rs.params, ...rs.layerParams?.[layer] };
    const changedHere = (name: string, decl: ParamDecl) =>
      layer === null ? isChanged(decl, rs.params[name]) : rs.layerParams?.[layer]?.[name] !== undefined;
    const stepChanged =
      Object.keys(rs.layerParams ?? {}).length > 0 || Object.entries(def.params).some(([n, d]) => isChanged(d as ParamDecl, rs.params[n]));
    const stale = props.stale.includes(index);
    const ran = props.steps.some((s) => s.index === index);
    items.push(
      <div
        key={`s${index}`}
        className={[
          "card step",
          enabled ? "" : "disabled",
          props.error?.index === index ? "has-error" : "",
          props.inspect === index ? "inspected" : "",
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
            <input
              type="checkbox"
              title={enabled ? "On (untick to skip this step)" : "Skipped"}
              checked={enabled}
              onChange={(e) => {
                const steps = recipe.steps.map((s, i) => (i === index ? { ...s, enabled: e.target.checked, offForEntry: undefined } : s));
                const issue = checkChain(recipe.input, steps, registry)[0];
                if (issue) props.onNotice(`${e.target.checked ? "Turning on" : "Skipping"} ${def.title} would break the chain: ${issue.reason}`);
                else props.onChange({ ...recipe, steps }, false);
              }}
            />
            {stepChanged && (
              <button
                className="icon"
                title="Defaults for this step: put every setting back (keeps the seed)"
                aria-label={`Defaults for ${def.title}`}
                onClick={() => props.onChange(resetStep(recipe, index, registry), false)}
              >
                ↺
              </button>
            )}
            <button className="help-btn" onClick={() => props.onHelp(def)} aria-label={`Help for ${def.title}`}>
              ?
            </button>
            <button className="icon" aria-label={`Remove ${def.title}`} onClick={() => commit(removeStep(recipe, index, registry))}>
              ✕
            </button>
          </span>
        </div>
        <p className="summary">{def.summary}</p>
        {enabled && layerStep && (
          <LayerScope
            step={rs}
            available={inputLayers(index)}
            editing={layer}
            onEditing={(l) => setEditing({ ...editing, [index]: l })}
            onChange={(patch) => patchStep(index, patch, false)}
          />
        )}
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
                onReset={() => props.onChange(resetParam(recipe, index, name, registry, layer ?? undefined), false)}
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

  if (props.only !== undefined) {
    const card = items.find((el) => el.key === `s${props.only}`);
    return <div className="steps">{card}</div>;
  }

  return (
    <div className="steps">
      {items}
      <p className="hint add-hint">To add a step, use a + between the boxes in the recipe strip below.</p>
    </div>
  );
}
