/**
 * The phone viewer's rules (#66, #74): when the screen counts as a phone, what the project
 * list shows, the before/after split, and read-only access to storage. Pure (no React), so
 * it's tested without a browser; `PhoneViewer.tsx` renders it.
 *
 * On a phone plotlab is a viewer only: it reads the same project storage as the editor
 * (ADR 0014) and never writes to it — no recipe edits, no checkpoints, no Back steps.
 */
import { listForProject } from "./checkpoints.ts";
import { memoryLibrary, type Checkpoint, type Library, type NewSource, type ProjectId, type ProjectInfo, type ProjectStore, type Source } from "./storage/index.ts";

/** Screens narrower than this get the viewer instead of the editor. */
export const PHONE_MAX_PX = 700;
/** The same rule as a media query (just under 700, so exactly 700 px is the editor). */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX - 0.02}px)`;
export const isPhoneWidth = (width: number) => width < PHONE_MAX_PX;

type Listen<T extends string> = { addEventListener(type: T, f: () => void): void; removeEventListener(type: T, f: () => void): void };
type WindowLike = Listen<"resize"> & { innerWidth: number; matchMedia?: (query: string) => Listen<"change"> & { matches: boolean } };

/**
 * Whether the screen is phone-sized right now, and a way to hear when that changes (turning
 * the phone, resizing the window). Shaped for React's useSyncExternalStore, so the very first
 * render already knows, and the editor never starts up on a phone.
 */
export function phoneWidth(win: WindowLike) {
  const mql = win.matchMedia?.(PHONE_QUERY);
  return {
    getSnapshot: () => (mql ? mql.matches : isPhoneWidth(win.innerWidth)),
    subscribe(onChange: () => void) {
      if (mql) {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      win.addEventListener("resize", onChange);
      return () => win.removeEventListener("resize", onChange);
    },
  };
}

/** Where the before/after line is, 0 (all after) to 1 (all before), from a finger at `clientX`. */
export function splitAt(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 0.5;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

/** The split moved by a key (arrows a twentieth, Home and End to the edges); null for other keys. */
export function nudgeSplit(split: number, key: string): number | null {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(split - 0.05);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(split + 0.05);
    case "Home":
      return 0;
    case "End":
      return 1;
    default:
      return null;
  }
}

/** What a tapped strip box shows: the source, a step's output (found by id), or the end result. */
export function inspectFor(recipe: { steps: ReadonlyArray<{ id: string }> }, key: string | null): number | "source" | null {
  if (key === "source") return "source";
  const i = key === null ? -1 : recipe.steps.findIndex((s) => s.id === key);
  return i < 0 ? null : i;
}

/** A project as the viewer sees it: reads only. */
export type ViewerProject = Pick<ProjectStore, "id" | "name" | "getSource" | "getRecipe" | "listCheckpoints" | "getThumbnail">;
/** The library as the viewer sees it: reads only. */
export interface ViewerLibrary {
  readonly persistent: boolean;
  listProjects(): Promise<ProjectInfo[]>;
  openProject(id: ProjectId): Promise<ViewerProject | undefined>;
  getLastOpened(): Promise<ProjectId | undefined>;
}

/**
 * The library with its writing calls left out, in the type and at run time: the viewer is
 * handed only this, so nothing it does can change a project.
 */
export function readOnlyLibrary(lib: Library): ViewerLibrary {
  return {
    persistent: lib.persistent,
    listProjects: () => lib.listProjects(),
    getLastOpened: () => lib.getLastOpened(),
    async openProject(id) {
      const p = await lib.openProject(id);
      if (!p) return undefined;
      return {
        id: p.id,
        name: p.name,
        getSource: () => p.getSource(),
        getRecipe: () => p.getRecipe(),
        listCheckpoints: () => p.listCheckpoints(),
        getThumbnail: (cp) => p.getThumbnail(cp),
      };
    },
  };
}

/**
 * The library the viewer shows. With no projects stored (a phone's own browser, until a
 * bundle is imported) it shows the sample as an example, kept in memory: nothing is stored.
 */
export async function viewerLibrary(lib: Library, sample: () => Promise<NewSource>): Promise<{ library: ViewerLibrary; example: boolean }> {
  if ((await lib.listProjects()).length) return { library: readOnlyLibrary(lib), example: false };
  const mem = memoryLibrary();
  await mem.createProject(await sample());
  return { library: readOnlyLibrary(mem), example: true };
}

export interface ProjectCard {
  id: ProjectId;
  name: string;
  checkpoints: number;
}

/** The project list: the last opened first, then by the most recent work (a recipe save or a checkpoint). */
export async function listProjectCards(lib: ViewerLibrary): Promise<ProjectCard[]> {
  const last = await lib.getLastOpened();
  const rows = await Promise.all(
    (await lib.listProjects()).map(async (info) => {
      const p = await lib.openProject(info.id);
      const cps = p ? await p.listCheckpoints() : [];
      const saved = (await p?.getRecipe())?.savedAt ?? 0;
      const latest = Math.max(saved, ...cps.map((c) => c.createdAt));
      return { card: { id: info.id, name: info.name, checkpoints: cps.length }, latest };
    }),
  );
  const rank = (r: (typeof rows)[number]) => Number(r.card.id === last);
  rows.sort((a, b) => rank(b) - rank(a) || b.latest - a.latest || (a.card.name < b.card.name ? -1 : 1));
  return rows.map((r) => r.card);
}

/** Image types a browser shows as they are (a TIFF doesn't). */
const SHOWABLE = /^image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml)$/;

/**
 * A project's picture in the list: its newest checkpoint's stored picture, else the image
 * itself if the browser can show it, else null. No drawing: the list costs the phone nothing.
 */
export async function projectCover(p: ViewerProject): Promise<{ bytes: Uint8Array; type: string } | null> {
  for (const cp of await listForProject(p)) {
    const bytes = await p.getThumbnail(cp.id);
    if (bytes) return { bytes, type: "image/png" };
  }
  const src = await p.getSource();
  return SHOWABLE.test(src.type) ? { bytes: src.bytes, type: src.type } : null;
}

/** One project opened for looking at: its image, saved recipe (as stored; may be absent) and checkpoints, newest first. */
export async function openForViewing(
  lib: ViewerLibrary,
  id: ProjectId,
): Promise<{ project: ViewerProject; source: Source; recipe: unknown; checkpoints: Checkpoint[] } | undefined> {
  const project = await lib.openProject(id);
  if (!project) return undefined;
  const [source, saved, checkpoints] = await Promise.all([project.getSource(), project.getRecipe(), listForProject(project)]);
  return { project, source, recipe: saved?.recipe, checkpoints };
}
