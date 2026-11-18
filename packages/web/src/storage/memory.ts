import { sha256Hex } from "./hash.ts";
import type { Checkpoint, Current, ProjectStore, SourceMeta, StoredSource } from "./types.ts";

/** Keeps everything in memory: for tests, and when the browser blocks IndexedDB. */
export function memoryStore(): ProjectStore {
  const sources = new Map<string, StoredSource>();
  const checkpoints = new Map<string, Checkpoint>();
  const thumbnails = new Map<string, Uint8Array>();
  let current: Current | undefined;
  const meta = ({ bytes: _, ...m }: StoredSource): SourceMeta => ({ ...m });

  return {
    persistent: false,
    async putSource(bytes, info) {
      const hash = await sha256Hex(bytes);
      const have = sources.get(hash);
      if (have) return meta(have);
      const s: StoredSource = { hash, name: info.name, type: info.type, size: bytes.length, addedAt: Date.now(), bytes: bytes.slice() };
      sources.set(hash, s);
      return meta(s);
    },
    async getSource(hash) {
      const s = sources.get(hash);
      return s && { ...s, bytes: s.bytes.slice() };
    },
    async listSources() {
      return [...sources.values()].map(meta);
    },
    async deleteSource(hash) {
      sources.delete(hash);
    },
    async getCurrent() {
      return current && structuredClone(current);
    },
    async setCurrent(c) {
      current = structuredClone(c);
    },
    async putCheckpoint(cp, thumbnail) {
      checkpoints.set(cp.id, structuredClone(cp));
      if (thumbnail) thumbnails.set(cp.id, thumbnail.slice());
    },
    async getCheckpoint(id) {
      const c = checkpoints.get(id);
      return c && structuredClone(c);
    },
    async listCheckpoints(filter) {
      return [...checkpoints.values()].filter((c) => filter?.sourceHash === undefined || c.sourceHash === filter.sourceHash).map((c) => structuredClone(c));
    },
    async getThumbnail(id) {
      return thumbnails.get(id)?.slice();
    },
    async deleteCheckpoint(id) {
      checkpoints.delete(id);
      thumbnails.delete(id);
    },
  };
}
