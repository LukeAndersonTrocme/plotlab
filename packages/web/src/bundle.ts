/**
 * Bundles (ADR 0014, GLOSSARY): exporting a project as its folder zipped, and opening one.
 * The format is `storage/bundle.ts`; this file has the rules and the README. No React.
 *
 * Opening a bundle **merges, never overwrites**: the project is the one for its image
 * (the source hash); checkpoints are added by id, and an id already here is left alone. A
 * new project takes the bundle's recipe and view block. An existing one keeps its own; if
 * the bundle's recipe is different, it's added as a checkpoint "From bundle", so nothing
 * is lost. Every recipe is upgraded (ADR 0002) before it's stored. Nothing is written
 * until the whole bundle has been read and checked, so a refused bundle changes nothing.
 */
import { isVisible, loadRecipe, type ParamDecl, type Recipe, type StepRegistry } from "@plotlab/engine";
import pkg from "../package.json";
import { createCheckpoint, listForProject, sameRecipe } from "./checkpoints.ts";
import { setupSummary } from "./setup.ts";
import { BundleError, folderName, readBundle, writeBundle } from "./storage/bundle.ts";
import { sha256Hex, type Checkpoint, type Library, type ProjectInfo } from "./storage/index.ts";
import type { ProjectStore } from "./storage/index.ts";

export { BundleError, MAX_BUNDLE_BYTES } from "./storage/bundle.ts";

/** The checkpoint that keeps a bundle's settings when the project here has its own. */
export const FROM_BUNDLE = "From bundle";
export const NO_SOURCE = "This bundle leaves out its image. Open the image first, then open the bundle again.";

const UNITS: Record<string, string> = { mm: " mm", px: " px", "%": "%", deg: "°", "": "" };

function paramText(d: ParamDecl, v: unknown): string {
  switch (d.type) {
    case "number":
      return typeof v === "number" ? `${Number(v.toFixed(4))}${UNITS[d.unit ?? ""] ?? ""}` : String(v);
    case "boolean":
      return v ? "on" : "off";
    case "enum":
      return d.options.find((o) => o.value === v)?.label ?? String(v);
    case "text":
      return v === "" ? "(empty)" : String(v);
    case "table":
      return v && typeof v === "object" && Object.keys(v).length ? JSON.stringify(v) : "no changes";
  }
}

/**
 * README.md: the steps and settings in plain words (the steps' own titles, summaries and
 * setting labels, as the app shows them), the CLI command, and the plotlab version.
 * `source` is the image's file name in the folder, or null when it was left out.
 */
export function bundleReadme(o: { name: string; recipe: Recipe; source: string | null; registry: StepRegistry; version: string }): string {
  const { recipe, registry } = o;
  const setup = setupSummary(recipe, null);
  const paper = setup.orientation ? `${setup.paper} ${setup.orientation}` : setup.paper;
  const steps = recipe.steps.map((s, i) => {
    const def = registry.get(s.step);
    if (!def) return `${i + 1}. ${s.step} (a step this version of plotlab doesn't know)`;
    const off = s.enabled === false ? " (switched off)" : "";
    const layers = Array.isArray(s.layers) ? `\n   - On layers: ${s.layers.join(", ")}` : "";
    const params = Object.entries(def.params as Record<string, ParamDecl>)
      .filter(([k]) => isVisible(def.params, k, s.params))
      .map(([k, d]) => `\n   - ${d.label}: ${paramText(d, s.params[k] ?? d.default)}`)
      .join("");
    return `${i + 1}. **${def.title}**${off}: ${def.summary}${layers}${params}`;
  });
  const inks = recipe.inks.map((k) => `${k.name} (${k.color}, ${k.widthMm} mm)`).join(", ");
  return [
    `# ${o.name}`,
    "",
    `A plotlab project, saved by plotlab ${o.version}. Open the zip in plotlab ("Open a bundle") to see it and its checkpoints.`,
    o.source ? "" : "\nThe source image was left out of this bundle: you need your own copy of it.\n",
    "## Steps",
    "",
    ...steps,
    "",
    "## Settings",
    "",
    `- Paper: ${paper}, margin ${recipe.layout.marginMm} mm (${recipe.layout.fit === "fit" ? "whole image fits inside" : "fills the margins, cropping"})`,
    `- ${setup.pens}: ${inks}`,
    `- Output: ${setup.machine}`,
    "",
    "## Command line",
    "",
    "    " + `plotlab run recipe.json -i ${o.source ?? "<your image>"} -o out/`,
    "",
  ].join("\n");
}

/** The bundle for a project: its folder zipped, named `<project>.zip`. */
export async function exportProject(project: ProjectStore, o: { leaveOutSource: boolean; registry: StepRegistry; version?: string }): Promise<{ name: string; bytes: Uint8Array }> {
  const saved = await project.getRecipe();
  let recipe: Recipe | undefined;
  try {
    recipe = saved && loadRecipe(saved.recipe, o.registry).recipe;
  } catch (e) {
    throw new BundleError(`This project's settings can't be read, so they can't be exported (${e instanceof Error ? e.message : String(e)}).`);
  }
  return writeBundle(project, {
    includeSource: !o.leaveOutSource,
    readme: (source) => (recipe ? bundleReadme({ name: folderName(project.name), recipe, source, registry: o.registry, version: o.version ?? pkg.version }) : ""),
  });
}

export interface ImportResult {
  project: ProjectInfo;
  /** The project wasn't here before. */
  created: boolean;
  added: number;
  already: number;
  /** Checkpoint files that couldn't be read (not JSON, missing fields, a recipe this build can't read). */
  skipped: number;
  /** The bundle's recipe was added as the checkpoint "From bundle". */
  fromBundle: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A checkpoint file's JSON, checked and its recipe upgraded; null if it can't be used. */
function readCheckpoint(json: unknown, parse: (json: unknown) => unknown): Checkpoint | null {
  if (!json || typeof json !== "object") return null;
  const c = json as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id || typeof c.createdAt !== "number" || !Number.isFinite(c.createdAt)) return null;
  try {
    return { id: c.id, createdAt: c.createdAt, sourceHash: str(c.sourceHash), recipe: parse(c.recipe), name: str(c.name), note: str(c.note) };
  } catch {
    return null;
  }
}

/**
 * Opens a bundle into the library (see the top of this file). `parse` upgrades a recipe
 * (the engine's loadRecipe) and throws if it can't. Throws a BundleError, writing nothing,
 * when the bundle can't be opened.
 */
export async function importBundle(library: Library, bytes: Uint8Array, o: { fileName: string; parse: (json: unknown) => unknown; maxBytes?: number }): Promise<ImportResult> {
  const b = readBundle(bytes, { fileName: o.fileName, ...(o.maxBytes !== undefined && { maxBytes: o.maxBytes }) });
  let recipe: unknown;
  try {
    recipe = o.parse(b.recipe);
  } catch (e) {
    throw new BundleError(`${o.fileName} can't be opened: its settings (recipe.json) can't be read by this version (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`);
  }
  const read = b.checkpoints.map((c) => ({ cp: readCheckpoint(c.json, o.parse), thumbnail: c.thumbnail }));
  const good = read.filter((r): r is { cp: Checkpoint; thumbnail: Uint8Array | undefined } => r.cp !== null);
  const skipped = read.length - good.length;

  // Which project: the image's hash, or (image left out) the one its checkpoints name.
  const id = b.source ? await sha256Hex(b.source.bytes) : good.find((g) => g.cp.sourceHash)?.cp.sourceHash;
  let project = id ? await library.openProject(id) : undefined;
  const created = !project;
  if (!project) {
    if (!b.source) throw new BundleError(NO_SOURCE);
    project = (await library.openProject((await library.createProject({ ...b.source, name: b.folder })).id))!;
  }

  const local = await project.getRecipe();
  let fromBundle = false;
  if (!local) {
    await project.setRecipe({ recipe, savedAt: Date.now() });
  }
  if ((await project.getView()) === undefined && b.view !== undefined) await project.setView(b.view);

  let added = 0;
  let already = 0;
  const here = new Set((await project.listCheckpoints()).map((c) => c.id));
  for (const { cp, thumbnail } of good) {
    if (here.has(cp.id)) {
      already++;
      continue;
    }
    await project.putCheckpoint({ ...cp, sourceHash: project.id }, thumbnail);
    here.add(cp.id);
    added++;
  }

  if (local) {
    let mine: unknown = local.recipe;
    try {
      mine = o.parse(local.recipe);
    } catch {
      /* compare as stored */
    }
    const kept = (await listForProject(project)).some((c) => sameRecipe(c.recipe, recipe));
    if (!sameRecipe(mine, recipe) && !kept) {
      await createCheckpoint(project, { recipe, name: FROM_BUNDLE, note: o.fileName });
      fromBundle = true;
    }
  }
  return { project: { id: project.id, name: project.name }, created, added, already, skipped, fromBundle };
}

const count = (n: number, one: string) => (n === 0 ? `no ${one}s` : n === 1 ? `1 ${one}` : `${n} ${one}s`);

/** What to tell the person, e.g. "Opened mona: 3 checkpoints added, 2 already here." */
export function importSummary(r: ImportResult): string {
  const parts = [`${count(r.added, "checkpoint")} added`];
  if (r.already) parts.push(`${r.already} already here`);
  if (r.skipped) parts.push(`${r.skipped} couldn't be read and ${r.skipped === 1 ? "was" : "were"} left out`);
  const from = r.fromBundle ? ` The bundle's current settings differ from yours, so they're saved as the checkpoint “${FROM_BUNDLE}”.` : "";
  return `Opened ${r.project.name}: ${parts.join(", ")}.${from}`;
}
