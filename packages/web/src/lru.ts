/** A Map that forgets the least recently used entry past `limit`. */
export class LruMap<K, V> {
  private m = new Map<K, V>();
  constructor(readonly limit: number) {}
  get size() {
    return this.m.size;
  }
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.limit) this.m.delete(this.m.keys().next().value as K);
  }
  delete(k: K): void {
    this.m.delete(k);
  }
}
