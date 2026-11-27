import { sha256Hex } from "./hash.ts";
import type { Checkpoint, Library, ProjectInfo, ProjectStore, SavedRecipe, Source } from "./types.ts";

interface Project {
  info: ProjectInfo;
  source: Source;
  recipe: SavedRecipe | undefined;
  view: unknown;
  checkpoints: Map<string, Checkpoint>;
  thumbnails: Map<string, Uint8Array>;
}

/** Everything in memory: for tests, and when the browser blocks IndexedDB. */
export function memoryLibrary(opts: { onSetRecipe?: (saved: SavedRecipe) => void } = {}): Library {
  const projects = new Map<string, Project>();
  let last: string | undefined;

  const store = (id: string): ProjectStore => {
    // Look the project up on every call, so a deleted project stops answering.
    const p = () => projects.get(id);
    return {
      id,
      name: projects.get(id)!.info.name,
      async getSource() {
        const s = p()!.source;
        return { type: s.type, bytes: s.bytes.slice() };
      },
      async getRecipe() {
        const r = p()?.recipe;
        return r && structuredClone(r);
      },
      async setRecipe(saved) {
        const x = p();
        if (x) x.recipe = structuredClone(saved);
        opts.onSetRecipe?.(saved);
      },
      async getView() {
        const v = p()?.view;
        return v === undefined ? undefined : structuredClone(v);
      },
      async setView(view) {
        const x = p();
        if (x) x.view = structuredClone(view);
      },
      async putCheckpoint(cp, thumbnail) {
        const x = p();
        if (!x) return;
        x.checkpoints.set(cp.id, structuredClone({ ...cp, sourceHash: id }));
        if (thumbnail) x.thumbnails.set(cp.id, thumbnail.slice());
      },
      async putThumbnail(cid, thumbnail) {
        const x = p();
        if (x?.checkpoints.has(cid)) x.thumbnails.set(cid, thumbnail.slice());
      },
      async getCheckpoint(cid) {
        const c = p()?.checkpoints.get(cid);
        return c && structuredClone(c);
      },
      async listCheckpoints() {
        return [...(p()?.checkpoints.values() ?? [])].map((c) => structuredClone(c));
      },
      async getThumbnail(cid) {
        return p()?.thumbnails.get(cid)?.slice();
      },
      async deleteCheckpoint(cid) {
        p()?.checkpoints.delete(cid);
        p()?.thumbnails.delete(cid);
      },
    };
  };

  return {
    persistent: false,
    async listProjects() {
      return [...projects.values()].map((p) => ({ ...p.info }));
    },
    async createProject(src) {
      const id = await sha256Hex(src.bytes);
      const have = projects.get(id);
      if (have) return { ...have.info };
      const info = { id, name: src.name };
      projects.set(id, { info, source: { type: src.type, bytes: src.bytes.slice() }, recipe: undefined, view: undefined, checkpoints: new Map(), thumbnails: new Map() });
      return { ...info };
    },
    async openProject(id) {
      return projects.has(id) ? store(id) : undefined;
    },
    async deleteProject(id) {
      projects.delete(id);
    },
    async getLastOpened() {
      return last;
    },
    async setLastOpened(id) {
      last = id;
    },
  };
}
