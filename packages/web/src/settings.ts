import type { ParamDecl, ParamDecls } from "@plotlab/engine";

/**
 * Settings that fold under "More settings" in a step card: random seeds and per-band
 * tables. Everything else is a main setting, shown first. Order follows the declaration.
 */
const isMore = (d: ParamDecl) => d.type === "table" || (d.type === "number" && d.seed === true);

export function splitSettings(decls: ParamDecls): { main: string[]; more: string[] } {
  const names = Object.keys(decls);
  return { main: names.filter((n) => !isMore(decls[n]!)), more: names.filter((n) => isMore(decls[n]!)) };
}
