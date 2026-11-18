import { sha256Hex } from "./hash.ts";
import type { Checkpoint, Current, ProjectStore, SourceMeta } from "./types.ts";

const DB_NAME = "plotlab";
const VERSION = 1;
// Metadata and bytes live in separate stores so listing never loads images.
const SOURCES = "sources"; // SourceMeta, key: hash
const SOURCE_BYTES = "sourceBytes"; // Uint8Array, key: hash
const CHECKPOINTS = "checkpoints"; // Checkpoint, key: id, index: bySource
const THUMBNAILS = "thumbnails"; // Uint8Array, key: checkpoint id
const KV = "kv"; // "current" → Current
const ALL = [SOURCES, SOURCE_BYTES, CHECKPOINTS, THUMBNAILS, KV];

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });

/**
 * IndexedDB adapter. Rejects if IndexedDB is missing or blocked (some private modes), so
 * the caller can fall back to memory. `factory` is injectable for tests (fake-indexeddb).
 */
export async function indexedDbStore(opts: { factory?: IDBFactory | undefined; name?: string } = {}): Promise<ProjectStore> {
  const factory = "factory" in opts ? opts.factory : globalThis.indexedDB;
  if (!factory) throw new Error("IndexedDB isn't available");
  const open = factory.open(opts.name ?? DB_NAME, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore(SOURCES, { keyPath: "hash" });
    db.createObjectStore(SOURCE_BYTES);
    db.createObjectStore(CHECKPOINTS, { keyPath: "id" }).createIndex("bySource", "sourceHash");
    db.createObjectStore(THUMBNAILS);
    db.createObjectStore(KV);
  };
  const db = await req(open);
  // Another tab upgrading later: let it, rather than block it.
  db.onversionchange = () => db.close();

  /** Run `fn` in one transaction and resolve with its result once it commits. */
  async function tx<T>(mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
    const t = db.transaction(ALL, mode);
    const finished = done(t);
    const out = await fn(t);
    await finished;
    return out;
  }
  const get = <T>(store: string, key: IDBValidKey) => tx("readonly", (t) => req(t.objectStore(store).get(key) as IDBRequest<T | undefined>));

  return {
    persistent: true,
    async putSource(bytes, info) {
      const hash = await sha256Hex(bytes);
      return tx("readwrite", async (t) => {
        const have = await req(t.objectStore(SOURCES).get(hash) as IDBRequest<SourceMeta | undefined>);
        if (have) return have;
        const meta: SourceMeta = { hash, name: info.name, type: info.type, size: bytes.length, addedAt: Date.now() };
        t.objectStore(SOURCES).put(meta);
        t.objectStore(SOURCE_BYTES).put(bytes, hash);
        return meta;
      });
    },
    async getSource(hash) {
      return tx("readonly", async (t) => {
        const meta = await req(t.objectStore(SOURCES).get(hash) as IDBRequest<SourceMeta | undefined>);
        const bytes = await req(t.objectStore(SOURCE_BYTES).get(hash) as IDBRequest<Uint8Array | undefined>);
        return meta && bytes ? { ...meta, bytes } : undefined;
      });
    },
    listSources: () => tx("readonly", (t) => req(t.objectStore(SOURCES).getAll() as IDBRequest<SourceMeta[]>)),
    deleteSource: (hash) =>
      tx("readwrite", (t) => {
        t.objectStore(SOURCES).delete(hash);
        t.objectStore(SOURCE_BYTES).delete(hash);
      }),
    getCurrent: () => get<Current>(KV, "current"),
    setCurrent: (c) =>
      tx("readwrite", (t) => {
        t.objectStore(KV).put(c, "current");
      }),
    putCheckpoint: (cp, thumbnail) =>
      tx("readwrite", (t) => {
        t.objectStore(CHECKPOINTS).put(cp);
        if (thumbnail) t.objectStore(THUMBNAILS).put(thumbnail, cp.id);
      }),
    getCheckpoint: (id) => get<Checkpoint>(CHECKPOINTS, id),
    listCheckpoints: (filter) =>
      tx("readonly", (t) => {
        const s = t.objectStore(CHECKPOINTS);
        const r = filter?.sourceHash === undefined ? s.getAll() : s.index("bySource").getAll(filter.sourceHash);
        return req(r as IDBRequest<Checkpoint[]>);
      }),
    getThumbnail: (id) => get<Uint8Array>(THUMBNAILS, id),
    deleteCheckpoint: (id) =>
      tx("readwrite", (t) => {
        t.objectStore(CHECKPOINTS).delete(id);
        t.objectStore(THUMBNAILS).delete(id);
      }),
  };
}
