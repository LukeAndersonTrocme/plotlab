import { randomSeed, type ParamDecl, type TableParam } from "@plotlab/engine";

const UNIT: Record<string, string> = { mm: "mm", "%": "%", deg: "°", px: "px", "": "" };

/**
 * One control generated from a param declaration. Numbers get a slider *and* a numeric
 * field (precise entry; friendlier on touch / Vision Pro).
 */
export function ParamControl(props: {
  name: string;
  decl: ParamDecl;
  value: unknown;
  onDrag: (v: unknown) => void;
  onCommit: (v: unknown) => void;
}) {
  const { name, decl: d, value } = props;
  const id = `p-${name}-${Math.random().toString(36).slice(2, 7)}`;
  if (d.type === "number" && d.seed) {
    return (
      <div className="param" title={d.help}>
        <label htmlFor={id}>{d.label}</label>
        <div className="param-row">
          <input
            id={id}
            className="num seed"
            type="number"
            min={d.min}
            max={d.max}
            step={1}
            value={value as number}
            onChange={(e) => e.target.value !== "" && props.onCommit(Math.round(Math.min(d.max, Math.max(d.min, Number(e.target.value)))))}
          />
          <button className="icon" title="New random variation" aria-label="Reroll seed" onClick={() => props.onCommit(randomSeed())}>
            🎲
          </button>
        </div>
      </div>
    );
  }
  if (d.type === "number") {
    const v = value as number;
    return (
      <div className="param" title={d.help}>
        <label htmlFor={id}>{d.label}</label>
        <div className="param-row">
          <input
            id={id}
            type="range"
            min={d.min}
            max={d.max}
            step={d.step ?? "any"}
            value={v}
            onChange={(e) => props.onDrag(Number(e.target.value))}
            onPointerUp={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
          />
          <input
            className="num"
            type="number"
            min={d.min}
            max={d.max}
            step={d.step ?? "any"}
            value={v}
            onChange={(e) => e.target.value !== "" && props.onCommit(Math.min(d.max, Math.max(d.min, Number(e.target.value))))}
          />
          <span className="unit">{UNIT[d.unit ?? ""] ?? d.unit}</span>
        </div>
      </div>
    );
  }
  if (d.type === "text") {
    return (
      <div className="param" title={d.help}>
        <label htmlFor={id}>{d.label}</label>
        <input
          id={id}
          className="text"
          type="text"
          placeholder={d.placeholder}
          defaultValue={value as string}
          onBlur={(e) => props.onCommit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && props.onCommit((e.target as HTMLInputElement).value)}
        />
      </div>
    );
  }
  if (d.type === "table") return <TableControl decl={d} value={value as Record<string, Record<string, number>>} onCommit={props.onCommit} />;
  if (d.type === "enum") {
    return (
      <div className="param" title={d.help}>
        <label htmlFor={id}>{d.label}</label>
        <select id={id} value={value as string} onChange={(e) => props.onCommit(e.target.value)}>
          {d.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="param param-bool" title={d.help}>
      <label>
        <input type="checkbox" checked={value as boolean} onChange={(e) => props.onCommit(e.target.checked)} /> {d.label}
      </label>
    </div>
  );
}

/** Per-row overrides (e.g. one band's spacing). Blank cells use the step's other settings. */
function TableControl(props: { decl: TableParam; value: Record<string, Record<string, number>>; onCommit: (v: unknown) => void }) {
  const { decl: d } = props;
  const value = props.value ?? {};
  const rows = Object.keys(value).sort((a, b) => Number(a) - Number(b));
  const cols = Object.entries(d.columns);
  const setCell = (row: string, col: string, raw: string) => {
    const next = { ...value, [row]: { ...value[row] } };
    if (raw === "") delete next[row]![col];
    else next[row]![col] = Number(raw);
    if (!Object.keys(next[row]!).length) delete next[row];
    props.onCommit(next);
  };
  const nextRow = String(rows.length ? Math.max(...rows.map(Number)) + 1 : 1);
  return (
    <div className="param" title={d.help}>
      <label>{d.label}</label>
      {rows.length > 0 && (
        <table className="ptable">
          <thead>
            <tr>
              <th>{d.rowLabel}</th>
              {cols.map(([k, c]) => (
                <th key={k}>
                  {c.label}
                  {c.unit ? ` (${c.unit})` : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <td>
                  <input
                    className="num tiny"
                    type="number"
                    min={1}
                    defaultValue={row}
                    onBlur={(e) => {
                      const to = String(Math.max(1, Math.round(Number(e.target.value) || 1)));
                      if (to === row || value[to]) return;
                      const { [row]: moved, ...rest } = value;
                      props.onCommit({ ...rest, [to]: moved });
                    }}
                  />
                </td>
                {cols.map(([k, c]) => (
                  <td key={k}>
                    <input
                      className="num tiny"
                      type="number"
                      min={c.min}
                      max={c.max}
                      step={c.step ?? "any"}
                      placeholder="–"
                      defaultValue={value[row]?.[k] ?? ""}
                      onBlur={(e) => setCell(row, k, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="icon"
                    aria-label={`Remove ${d.rowLabel} ${row} override`}
                    onClick={() => {
                      const { [row]: _, ...rest } = value;
                      props.onCommit(rest);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={() => props.onCommit({ ...value, [nextRow]: { [cols[0]![0]]: cols[0]![1].min } })}>+ Override a {d.rowLabel.toLowerCase()}</button>
    </div>
  );
}
