/**
 * SHA-256 as lowercase hex. Web Crypto where it exists; it doesn't on plain http (a phone
 * testing `vite --host`), so there's a small pure-JS version too (no dependency needed).
 */
export async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): Promise<string> {
  if (!subtle) return sha256Js(bytes);
  return hex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Round constants and initial hash: fractional parts of cube / square roots of the first primes.
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);
const frac = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(PRIMES, (p) => frac(Math.cbrt(p)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => frac(Math.sqrt(p)));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** FIPS 180-4 SHA-256, for when Web Crypto is missing. */
export function sha256Js(data: Uint8Array): string {
  const len = data.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 2 ** 29));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0]! += a; h[1]! += b; h[2]! += c; h[3]! += d; h[4]! += e; h[5]! += f; h[6]! += g; h[7]! += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return hex(out);
}
