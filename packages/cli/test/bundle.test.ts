import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRegistry } from "@plotlab/steps";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { bin: Record<string, string> };
const binPath = join(pkgDir, Object.values(pkg.bin)[0]!);

// Run the bundle from a bare temp folder: no node_modules to resolve from, no tsx loader,
// and a PATH holding only the node binary's folder.
let dir = "";
let bundle = "";
const env = { PATH: dirname(process.execPath), HOME: tmpdir() };
const cli = (...args: string[]) => spawnSync(process.execPath, [bundle, ...args], { cwd: dir, env, encoding: "utf8" });

beforeAll(() => {
  const build = spawnSync(process.execPath, [join(pkgDir, "scripts", "build.mjs")], { encoding: "utf8" });
  expect(build.status, build.stderr).toBe(0);
  dir = mkdtempSync(join(tmpdir(), "cli-bundle-"));
  bundle = join(dir, basename(binPath));
  copyFileSync(binPath, bundle);
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("bundled CLI", () => {
  it("bin points at a single-file bundle with a node shebang", () => {
    expect(binPath).toMatch(/[\\/]dist[\\/][^\\/]+\.mjs$/);
    expect(readFileSync(binPath, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("steps list runs without tsx and lists every registered step", () => {
    const r = cli("steps", "list");
    expect(r.status, r.stderr).toBe(0);
    for (const s of createRegistry().list()) expect(r.stdout).toMatch(new RegExp(`^${s.id} `, "m"));
  });

  // Every input format decodes from the bare folder too: no decoder may load files
  // (such as a .wasm) from node_modules at run time.
  it.each(["shapes.png", "shapes.webp", "separations.tif", "drawing.svg"])("renders %s from the bundle alone", (fixture) => {
    const golden = join(pkgDir, "..", "..", "golden");
    const r = cli("run", join(golden, "cases", "shapes-centerline.recipe.json"), "-i", join(golden, "fixtures", fixture), "-o", join(dir, "out", fixture));
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, "out", fixture, "plot.svg"), "utf8")).toContain("<path");
  });

  it("--help exits 0 and prints usage", () => {
    const r = cli("--help");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("steps list");
  });
});
