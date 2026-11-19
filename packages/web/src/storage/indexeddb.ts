import { sha256Hex } from "./hash.ts";
import type { Checkpoint, Library, ProjectInfo, ProjectStore, SavedRecipe, Source } from "./types.ts";

const DB_NAME = "plotlab";
const VERSION = 1;
// Metadata and bytes live in separate stores so listing never loads images.
const PROJECTS = "projects"; // { id, name, type }, key: id
const SOURCES = "sources"; // Uint8Array, key: project id
const RECIPES = "recipes"; // SavedRecipe, key: project id
const CHECKPOINTS = "checkpoints"; // Checkpoint, key: id, index byProject (sourceHash)
const THUMBNAILS = "thumbnails"; // Uint8Array, key: checkpoint id
const KV = "kv"; // "lastOpened" → project id
const ALL = [PROJECTS, SOURCES, RECIPES, CHECKPOINTS, THUMBNAILS, KV];

const LOST = "Storage was upgraded in another tab. Reload this page to keep saving.";

const asError = (e: unknown, what: string): Error => (e instanceof Error ? e : new Error(e ? `${what}: ${String(e)}` : what));

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(asError(r.error, "IndexedDB request failed"));
  });

const done = (t: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(asError(t.error, "IndexedDB transaction failed"));
    t.onabort = () => reject(asError(t.error, "IndexedDB transaction aborted"));
  });

type Meta = ProjectInfo & { type: string };

/**
 * IndexedDB adapter. Rejects (so the caller can fall back to memory) if IndexedDB is
 * missing, fails, is blocked by another tab, or doesn't open within `timeoutMs`.
 * `onLost` is called if another tab upgrades the database and this connection closes.
 */
export async function indexedDbLibrary(
  opts: { factory?: IDBFactory | undefined; name?: string; timeoutMs?: number; onLost?: () => void } = {},
): Promise<Library> {
  const factory = "factory" in opts ? opts.factory : globalThis.indexedDB;
  if (!factory) throw new Error("IndexedDB isn't available");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error("IndexedDB didn't open in time")), opts.timeoutMs ?? 4000);
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(opts.name ?? DB_NAME, VERSION);
    } catch (e) {
      return fail(asError(e, "IndexedDB failed to open"));
    }
    open.onupgradeneeded = (e) => {
      const d = open.result;
      if (e.oldVersion < 1) {
        d.createObjectStore(PROJECTS, { keyPath: "id" });
        d.createObjectStore(SOURCES);
        d.createObjectStore(RECIPES);
        d.createObjectStore(CHECKPOINTS, { keyPath: "id" }).createIndex("byProject", "sourceHash");
        d.createObjectStore(THUMBNAILS);
        d.createObjectStore(KV);
      }
      // Version 2 adds its stores here, under `if (e.oldVersion < 2)`.
    };
    open.onsuccess = () => {
      if (settled) return open.result.close(); // too late: we already fell back
      settled = true;
      clearTimeout(timer);
      resolve(open.result);
    };
    open.onerror = () => fail(asError(open.error, "IndexedDB failed to open"));
    open.onblocked = () => fail(new Error("IndexedDB is blocked by another tab"));
  });

  let lost = false;
  db.onversionchange = () => {
    // A newer build in another tab wants to upgrade: let it, and say so here.
    db.close();
    lost = true;
    opts.onLost?.();
  };

  /** Run `fn` in one transaction; resolve with its result once the transaction commits. */
  async function tx<T>(mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
    if (lost) throw new Error(LOST);
    let t: IDBTransaction;
    try {
      t = db.transaction(ALL, mode);
    } catch (e) {
      throw lost ? new Error(LOST) : asError(e, "IndexedDB transaction failed");
    }
    const finished = done(t);
    finished.catch(() => {}); // awaited below; this only stops an unhandled rejection if fn fails
    let out: T;
    try {
      out = await fn(t);
    } catch (e) {
      try {
        t.abort();
      } catch {
        /* already finished */
      }
      throw asError(e, "IndexedDB transaction failed");
    }
    await finished;
    return out;
  }
  const get = <T>(t: IDBTransaction, store: string, key: IDBValidKey) => req(t.objectStore(store).get(key) as IDBRequest<T | undefined>);

  const project = (info: ProjectInfo): ProjectStore => {
    const { id } = info;
    /** The checkpoint, if it belongs to this project. */
    const own = async (t: IDBTransaction, cid: string) => {
      const c = await get<Checkpoint>(t, CHECKPOINTS, cid);
      return c?.sourceHash === id ? c : undefined;
    };
    return {
      id,
      name: info.name,
      getSource: () =>
        tx("readonly", async (t) => {
          const meta = await get<Meta>(t, PROJECTS, id);
          const bytes = await get<Uint8Array>(t, SOURCES, id);
          if (!meta || !bytes) throw new Error(`The image for “${info.name}” is no longer stored`);
          return { type: meta.type, bytes } satisfies Source;
        }),
      getRecipe: () => tx("readonly", (t) => get<SavedRecipe>(t, RECIPES, id)),
      setRecipe: (saved) =>
        tx("readwrite", (t) => {
          t.objectStore(RECIPES).put(saved, id);
        }),
      putCheckpoint: (cp, thumbnail) =>
        tx("readwrite", (t) => {
          t.objectStore(CHECKPOINTS).put({ ...cp, sourceHash: id });
          if (thumbnail) t.objectStore(THUMBNAILS).put(thumbnail, cp.id);
        }),
      getCheckpoint: (cid) => tx("readonly", (t) => own(t, cid)),
      listCheckpoints: () => tx("readonly", (t) => req(t.objectStore(CHECKPOINTS).index("byProject").getAll(id) as IDBRequest<Checkpoint[]>)),
      getThumbnail: (cid) => tx("readonly", async (t) => ((await own(t, cid)) ? get<Uint8Array>(t, THUMBNAILS, cid) : undefined)),
      deleteCheckpoint: (cid) =>
        tx("readwrite", async (t) => {
          if (!(await own(t, cid))) return;
          t.objectStore(CHECKPOINTS).delete(cid);
          t.objectStore(THUMBNAILS).delete(cid);
        }),
    };
  };

  return {
    persistent: true,
    listProjects: () => tx("readonly", async (t) => (await req(t.objectStore(PROJECTS).getAll() as IDBRequest<Meta[]>)).map(({ id, name }) => ({ id, name }))),
    async createProject(src) {
      const id = await sha256Hex(src.bytes);
      return tx("readwrite", async (t) => {
        const have = await get<Meta>(t, PROJECTS, id);
        if (have) return { id, name: have.name };
        t.objectStore(PROJECTS).put({ id, name: src.name, type: src.type } satisfies Meta);
        t.objectStore(SOURCES).put(src.bytes, id);
        return { id, name: src.name };
      });
    },
    openProject: (id) =>
      tx("readonly", async (t) => {
        const meta = await get<Meta>(t, PROJECTS, id);
        return meta ? project(meta) : undefined;
      }),
    deleteProject: (id) =>
      tx("readwrite", async (t) => {
        const ids = await req(t.objectStore(CHECKPOINTS).index("byProject").getAllKeys(id));
        for (const cid of ids) {
          t.objectStore(CHECKPOINTS).delete(cid);
          t.objectStore(THUMBNAILS).delete(cid);
        }
        for (const s of [PROJECTS, SOURCES, RECIPES]) t.objectStore(s).delete(id);
      }),
    getLastOpened: () => tx("readonly", (t) => get<string>(t, KV, "lastOpened")),
    setLastOpened: (id) =>
      tx("readwrite", (t) => {
        t.objectStore(KV).put(id, "lastOpened");
      }),
  };
}
