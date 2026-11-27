/**
 * The bundle (ADR 0014, GLOSSARY): the project folder, zipped.
 *
 *   <project>/
 *     source.<ext>                         optional ("Leave out source image")
 *     recipe.json
 *     view.json                            only when the project has a view block
 *     checkpoints/<timestamp>-<slug>.json  id, createdAt, sourceHash, recipe, name, note
 *     checkpoints/<timestamp>-<slug>.png   its picture, when stored
 *     README.md                            written by the caller (`readme`, given the source's file name)
 *
 * Only the format lives here: a project to zip bytes, and zip bytes to what they hold. The
 * rules for opening one (merge by id, upgrade recipes) are in `bundle.ts`, which also writes
 * the README. Like the rest of `storage/`, no React, DOM or Node, so it can become a package.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { ProjectStore, Source } from "./types.ts";

/** The most a bundle may unpack to. Bigger ones are refused, so a broken or hostile file can't fill memory. */
export const MAX_BUNDLE_BYTES = 200e6;
/** A size limit as the messages say it, e.g. "200 MB" (decimal MB, like the cap). */
export const sizeLimitText = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** A bundle that can't be written or read. The message is in plain words, for the screen. */
export class BundleError extends Error {
  override name = "BundleError";
}

/** What a bundle holds, as read. Nothing is checked beyond being JSON: `bundle.ts` does that. */
export interface ParsedBundle {
  /** The project folder's name (or the zip's, when its files are at the root). */
  folder: string;
  source?: Source;
  recipe: unknown;
  /** view.json; absent when there's none or it isn't JSON (a reader ignores what it can't read). */
  view?: unknown;
  /** One per checkpoints/*.json; `json` is undefined when the file isn't JSON. */
  checkpoints: Array<{ file: string; json: unknown; thumbnail?: Uint8Array }>;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tif",
  "image/svg+xml": "svg",
};
const TYPE: Record<string, string> = { ...Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t])), jpeg: "image/jpeg", tiff: "image/tiff" };

const extOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
/** A file or folder name that works on every system. */
const safeName = (s: string, fallback: string) =>
  s
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .replace(/[. ]+$/, "") || fallback;

/** The project folder's name: the project's name without its extension. */
export const folderName = (projectName: string) => safeName(projectName.replace(/\.[A-Za-z0-9]+$/, ""), "project");

const pad = (n: number) => String(n).padStart(2, "0");
/** e.g. 20261126-133805 (UTC), so files sort by time. */
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
};
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "checkpoint";
const pretty = (v: unknown) => strToU8(JSON.stringify(v, null, 2) + "\n");

/** Zips a project folder. Throws a BundleError when the project has no saved settings yet. */
export async function writeBundle(project: ProjectStore, opts: { includeSource: boolean; readme: (source: string | null) => string }): Promise<{ name: string; bytes: Uint8Array }> {
  const saved = await project.getRecipe();
  if (!saved) throw new BundleError("This project has no saved settings yet, so there's nothing to export.");
  const folder = folderName(project.name);
  const files: Zippable = {};
  const put = (path: string, data: Uint8Array) => (files[`${folder}/${path}`] = data);
  let source: string | null = null;
  if (opts.includeSource) {
    const src = await project.getSource();
    source = `source.${EXT[src.type] ?? extOf(project.name) ?? "bin"}`;
    put(source, src.bytes);
  }
  put("recipe.json", pretty(saved.recipe));
  const view = await project.getView();
  if (view !== undefined) put("view.json", pretty(view));
  const used = new Set<string>();
  const cps = (await project.listCheckpoints()).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  for (const cp of cps) {
    const base = `${stamp(cp.createdAt)}-${slug(cp.name)}`;
    let stem = base;
    for (let n = 2; used.has(stem); n++) stem = `${base}-${n}`;
    used.add(stem);
    const { id, createdAt, sourceHash, recipe, name, note } = cp;
    put(`checkpoints/${stem}.json`, pretty({ id, createdAt, sourceHash, recipe, name, note }));
    const thumb = await project.getThumbnail(cp.id);
    if (thumb) put(`checkpoints/${stem}.png`, thumb);
  }
  put("README.md", strToU8(opts.readme(source)));
  return { name: `${folder}.zip`, bytes: zipSync(files) };
}

/** Files a zip tool adds that aren't part of the folder. */
const junk = (path: string) => path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path);

/**
 * Reads a bundle. The folder may be at the zip's root or nested one level (people re-zip
 * folders); with its files at the root, the zip's name names it. Throws a BundleError.
 */
export function readBundle(bytes: Uint8Array, opts: { fileName: string; maxBytes?: number }): ParsedBundle {
  const max = opts.maxBytes ?? MAX_BUNDLE_BYTES;
  const tooBig = () => new BundleError(`${opts.fileName} is too big to open (over ${sizeLimitText(max)} unpacked).`);
  if (bytes.length > max) throw tooBig();
  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    entries = unzipSync(bytes, {
      filter(f) {
        if (junk(f.name)) return false;
        total += f.originalSize;
        if (total > max) throw tooBig();
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError(`${opts.fileName} isn't a bundle: it isn't a zip file, or it's damaged.`);
  }

  const recipes = Object.keys(entries).filter((p) => /(^|\/)recipe\.json$/.test(p) && p.split("/").length <= 3);
  const depth = (p: string) => p.split("/").length;
  const top = Math.min(...recipes.map(depth));
  const roots = recipes.filter((p) => depth(p) === top);
  if (roots.length === 0) throw new BundleError(`${opts.fileName} isn't a plotlab bundle: there's no recipe.json in it.`);
  if (roots.length > 1) throw new BundleError(`${opts.fileName} holds more than one project. Open them one at a time.`);
  const prefix = roots[0]!.slice(0, -"recipe.json".length);
  const folder = prefix ? prefix.slice(0, -1).split("/").pop()! : opts.fileName.replace(/\.zip$/i, "");

  const file = (path: string) => entries[prefix + path];
  const readJson = (data: Uint8Array | undefined): unknown => {
    if (!data) return undefined;
    try {
      return JSON.parse(strFromU8(data));
    } catch {
      return undefined;
    }
  };
  const recipe = readJson(file("recipe.json"));
  if (recipe === undefined) throw new BundleError(`${opts.fileName} can't be opened: its recipe.json isn't readable.`);

  const own = Object.keys(entries)
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length));
  const sourcePath = own.find((p) => /^source\.[^/]+$/.test(p));
  const ext = sourcePath && extOf(sourcePath);
  const view = readJson(file("view.json"));
  const checkpoints = own
    .filter((p) => /^checkpoints\/[^/]+\.json$/.test(p))
    .sort()
    .map((p) => {
      const thumbnail = file(p.replace(/\.json$/, ".png"));
      return { file: p.slice("checkpoints/".length), json: readJson(file(p)), ...(thumbnail && { thumbnail }) };
    });
  return {
    folder: safeName(folder, "project"),
    ...(sourcePath && { source: { bytes: file(sourcePath)!, type: (ext && TYPE[ext]) || "application/octet-stream" } }),
    recipe,
    ...(view !== undefined && { view }),
    checkpoints,
  };
}
