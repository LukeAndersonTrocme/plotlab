import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, sha256Js } from "../src/storage/hash.ts";

const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("sha256", () => {
  it("the pure-JS fallback matches node:crypto around block boundaries and on bigger inputs", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(sha256Js(b), `length ${n}`).toBe(node(b));
    }
    expect(sha256Js(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("uses Web Crypto when it's there, and the fallback where it isn't (plain http)", async () => {
    const b = new Uint8Array([1, 2, 3]);
    expect(await sha256Hex(b)).toBe(node(b));
    expect(await sha256Hex(b, undefined)).toBe(node(b));
  });
});
