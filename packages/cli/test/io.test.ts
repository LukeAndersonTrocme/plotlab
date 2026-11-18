import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readImage, readSource } from "../src/io.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = (name: string) => join(root, "golden", "fixtures", name);
const node = process.execPath;
const main = join(root, "packages", "cli", "src", "main.ts");

/** Run the CLI as a person would, through tsx. */
function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(node, ["--import", "tsx", main, ...args], { cwd: root, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function writeRecipe(dir: string, steps: string[]): string {
  const path = join(dir, "recipe.in.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 2,
      target: { kind: "plotter" },
      paper: { widthMm: 210, heightMm: 148 },
      inks: [{ id: "k", color: "#111111", widthMm: 0.5 }],
      steps: steps.map((step) => ({ step })),
    }),
  );
  return path;
}

describe("readSource", () => {
  it("decodes WebP (lossless fixture matches the PNG it was made from)", () => {
    const webp = readSource(fixture("shapes.webp"));
    const png = readImage(fixture("shapes.png"));
    expect("kind" in webp).toBe(false);
    if ("kind" in webp) return;
    expect([webp.width, webp.height]).toEqual([png.width, png.height]);
    expect(webp.data).toEqual(png.data);
  });
  it("a multi-page TIFF enters as layers named after its pages", () => {
    const s = readSource(fixture("separations.tif"));
    expect("kind" in s && s.kind).toBe("layers");
    if (!("kind" in s) || s.kind !== "layers") return;
    expect(s.layers.map((l) => l.name)).toEqual(["Cyan", "Magenta", "Yellow"]);
  });
  it("an SVG enters as lines", () => {
    const s = readSource(fixture("drawing.svg"));
    expect("kind" in s && s.kind).toBe("geometry");
  });
  it("names the supported formats for anything else", () => {
    expect(() => readSource("photo.bmp")).toThrow(/\.png, \.jpg, \.webp, \.tif, \.svg/);
  });
});

describe("plotlab run (round trip)", () => {
  it("reads a WebP and plots it", () => {
    const dir = mkdtempSync(join(tmpdir(), "plotlab-cli-"));
    const r = cli(["run", writeRecipe(dir, ["threshold", "centerline", "order"]), "-i", fixture("shapes.webp"), "-o", dir]);
    expect(r.stderr).not.toMatch(/error/);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/plot\.svg {2}\d+ strokes/);
    expect(readFileSync(join(dir, "plot.svg"), "utf8")).toMatch(/<path/);
  });
  it("reads an SVG: the photo steps are switched off, with a warning, and the lines are plotted", () => {
    const dir = mkdtempSync(join(tmpdir(), "plotlab-cli-"));
    const r = cli(["run", writeRecipe(dir, ["threshold", "centerline", "order"]), "-i", fixture("drawing.svg"), "-o", dir]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/drawing\.svg enters as lines.*Switched off Threshold and Centerline/s);
    const out = readFileSync(join(dir, "plot.svg"), "utf8");
    expect(out).toMatch(/<path/);
    // The recipe written next to the output is the one that ran.
    const ran = JSON.parse(readFileSync(join(dir, "recipe.json"), "utf8"));
    expect(ran.input).toBe("geometry");
    expect(ran.steps.map((s: { enabled: boolean }) => s.enabled)).toEqual([false, false, true]);
  });
  it("reads a multi-page TIFF as separations", () => {
    const dir = mkdtempSync(join(tmpdir(), "plotlab-cli-"));
    const r = cli(["run", writeRecipe(dir, ["threshold", "centerline", "order"]), "-i", fixture("separations.tif"), "-o", dir]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/3 pages.*enters as layers/s);
    expect(r.stdout).toMatch(/\d+ strokes/);
  });
});
