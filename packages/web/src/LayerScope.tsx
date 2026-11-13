import type { LayerInfo, RecipeStep } from "@plotlab/engine";

/**
 * For layer-acting steps (ADR 0009): which layers the step applies to, and whose
 * settings the controls below are editing ("All" = shared, or one layer's overrides).
 */
export function LayerScope(props: {
  step: RecipeStep;
  available: LayerInfo[];
  editing: string | null;
  onEditing: (layerId: string | null) => void;
  onChange: (patch: Partial<RecipeStep>) => void;
}) {
  const { step: rs, available } = props;
  if (available.length < 2 && !rs.layers && !rs.layerParams) return null;
  const all = rs.layers === undefined || rs.layers === "all";
  const on = (id: string) => all || (rs.layers as string[]).includes(id);
  const toggle = (id: string) => {
    const current = all ? available.map((l) => l.id) : (rs.layers as string[]);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    props.onChange({ layers: next.length === available.length && available.every((l) => next.includes(l.id)) ? undefined : next });
  };
  const selected = available.filter((l) => on(l.id));
  const overridden = (id: string) => Object.keys(rs.layerParams?.[id] ?? {}).length > 0;
  return (
    <div className="scope">
      <div className="scope-row">
        <span className="scope-label">Applies to</span>
        {available.map((l) => (
          <label key={l.id} className="chip">
            <input type="checkbox" checked={on(l.id)} onChange={() => toggle(l.id)} /> {l.name}
          </label>
        ))}
      </div>
      {selected.length > 1 && (
        <div className="scope-row">
          <span className="scope-label">Settings for</span>
          <button className={props.editing === null ? "chip on" : "chip"} onClick={() => props.onEditing(null)}>
            All
          </button>
          {selected.map((l) => (
            <button key={l.id} className={props.editing === l.id ? "chip on" : "chip"} onClick={() => props.onEditing(l.id)}>
              {l.name}
              {overridden(l.id) ? " •" : ""}
            </button>
          ))}
        </div>
      )}
      {props.editing !== null && (
        <p className="hint">
          Changes here only affect {available.find((l) => l.id === props.editing)?.name ?? props.editing}.{" "}
          {overridden(props.editing) && (
            <button
              className="link"
              onClick={() => {
                const { [props.editing!]: _, ...rest } = rs.layerParams ?? {};
                props.onChange({ layerParams: Object.keys(rest).length ? rest : undefined });
              }}
            >
              Use shared settings
            </button>
          )}
        </p>
      )}
    </div>
  );
}
