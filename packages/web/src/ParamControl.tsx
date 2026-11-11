import type { ParamDecl } from "@plotlab/engine";

const UNIT: Record<string, string> = { "source-units": "px", mm: "mm", "%": "%", deg: "°", px: "px", "": "" };

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
