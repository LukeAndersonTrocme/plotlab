/**
 * Parameter declarations. From one declaration we derive: UI controls, recipe
 * validation, CLI flags, docs. Keep this the single source of truth.
 */

interface ParamBase {
  label: string;
  /** One-line tooltip. Long-form help lives in the step's help.md. */
  help: string;
  /** Show (and validate) this param only when another param has one of these values. */
  visibleWhen?: { param: string; equals: Array<string | number | boolean> };
}

export interface NumberParam extends ParamBase {
  type: "number";
  min: number;
  max: number;
  step?: number;
  default: number;
  unit?: "mm" | "px" | "%" | "deg" | "";
  /** This number is a random seed (see `seedParam`); the UI adds a reroll button. */
  seed?: true;
}

export interface BooleanParam extends ParamBase {
  type: "boolean";
  default: boolean;
}

export interface EnumParam<V extends string = string> extends ParamBase {
  type: "enum";
  options: Array<{ value: V; label: string }>;
  default: V;
}

export type ParamDecl = NumberParam | BooleanParam | EnumParam;
export type ParamDecls = Record<string, ParamDecl>;

/** Map a declaration record to the runtime values type. */
export type ParamValues<D extends ParamDecls> = {
  [K in keyof D]: D[K] extends NumberParam
    ? number
    : D[K] extends BooleanParam
      ? boolean
      : D[K] extends EnumParam<infer V>
        ? V
        : never;
};

export function defaultParams<D extends ParamDecls>(decls: D): ParamValues<D> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(decls)) out[k] = d.default;
  return out as ParamValues<D>;
}

export function isVisible(decls: ParamDecls, name: string, values: Record<string, unknown>): boolean {
  const d = decls[name];
  if (!d?.visibleWhen) return true;
  return d.visibleWhen.equals.includes(values[d.visibleWhen.param] as never);
}

export interface ParamIssue {
  param: string;
  message: string;
}

/**
 * Fill defaults, reject unknown keys and wrong types, clamp numbers into range
 * (reported as an issue so nothing changes silently).
 */
export function resolveParams<D extends ParamDecls>(
  decls: D,
  raw: Record<string, unknown> | undefined,
): { values: ParamValues<D>; issues: ParamIssue[] } {
  const issues: ParamIssue[] = [];
  const values: Record<string, unknown> = {};
  const input = raw ?? {};
  for (const key of Object.keys(input)) {
    if (!(key in decls)) issues.push({ param: key, message: `unknown parameter "${key}"` });
  }
  for (const [k, d] of Object.entries(decls)) {
    const v = input[k];
    if (v === undefined) {
      values[k] = d.default;
      continue;
    }
    switch (d.type) {
      case "number":
        if (typeof v !== "number" || Number.isNaN(v)) {
          issues.push({ param: k, message: `expected a number, got ${JSON.stringify(v)}` });
          values[k] = d.default;
        } else if (v < d.min || v > d.max) {
          issues.push({ param: k, message: `${v} is outside ${d.min}..${d.max}; clamped` });
          values[k] = Math.min(d.max, Math.max(d.min, v));
        } else values[k] = v;
        break;
      case "boolean":
        if (typeof v !== "boolean") {
          issues.push({ param: k, message: `expected true/false, got ${JSON.stringify(v)}` });
          values[k] = d.default;
        } else values[k] = v;
        break;
      case "enum":
        if (!d.options.some((o) => o.value === v)) {
          issues.push({
            param: k,
            message: `expected one of ${d.options.map((o) => o.value).join(", ")}, got ${JSON.stringify(v)}`,
          });
          values[k] = d.default;
        } else values[k] = v;
        break;
    }
  }
  return { values: values as ParamValues<D>, issues };
}
