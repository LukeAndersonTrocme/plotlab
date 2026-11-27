import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { loadRecipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { memoryLibrary, sha256Hex, type Checkpoint, type Library, type ProjectStore } from "../src/storage/index.ts";
import { BundleError, readBundle, writeBundle } from "../src/storage/bundle.ts";
import { bundleReadme, exportProject, FROM_BUNDLE, importBundle, importSummary } from "../src/bundle.ts";
import { createCheckpoint, listForProject } from "../src/checkpoints.ts";
import { defaultRecipe } from "../src/defaults.ts";

const registry = createRegistry();
const parse = (json: unknown) => loadRecipe(json, registry).recipe;
/** The default recipe as the app stores it (through the upgrader). */
const fresh = () => parse(defaultRecipe());
const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

async function project(lib: Library, name = "mona.jpg", bytes = jpeg): Promise<ProjectStore> {
  return (await lib.openProject((await lib.createProject({ bytes, name, type: "image/jpeg" })).id))!;
}
/** A project with a recipe, a view block and two checkpoints (one with a picture). */
async function filled(lib: Library) {
  const p = await project(lib);
  const recipe = fresh();
  await p.setRecipe({ recipe, savedAt: 10 });
  await p.setView({ version: 1, pins: ["threshold"], extra: "kept" });
  const a = await createCheckpoint(p, { recipe, name: "First try", note: "darker", thumbnail: png(1), now: Date.UTC(2026, 10, 26, 13, 38, 5) });
  const b = await createCheckpoint(p, { recipe: { ...recipe, layout: { ...recipe.layout, marginMm: 20 } }, now: Date.UTC(2026, 10, 26, 14, 0, 0) });
  return { p, recipe, a, b };
}
const files = (bytes: Uint8Array) => Object.keys(unzipSync(bytes)).sort();
const json = (o: unknown) => strToU8(JSON.stringify(o));
const byId = (cps: Checkpoint[]) => [...cps].sort((x, y) => (x.id < y.id ? -1 : 1));

describe("bundle format (storage/bundle.ts)", () => {
  it("writes the project folder: source, recipe, view, checkpoints with pictures, README", async () => {
    const { p } = await filled(memoryLibrary());
    const out = await writeBundle(p, { includeSource: true, readme: () => "# hi" });
    expect(out.name).toBe("mona.zip");
    expect(files(out.bytes)).toEqual([
      "mona/README.md",
      "mona/checkpoints/20261126-133805-first-try.json",
      "mona/checkpoints/20261126-133805-first-try.png",
      "mona/checkpoints/20261126-140000-checkpoint.json",
      "mona/recipe.json",
      "mona/source.jpg",
      "mona/view.json",
    ]);
  });

  it("leaves out the source image when asked, and view.json when there's no view block", async () => {
    const lib = memoryLibrary();
    const p = await project(lib);
    await p.setRecipe({ recipe: fresh(), savedAt: 1 });
    const out = await writeBundle(p, { includeSource: false, readme: () => "" });
    expect(files(out.bytes)).toEqual(["mona/README.md", "mona/recipe.json"]);
  });

  it("two checkpoints with the same time and name get different file names", async () => {
    const lib = memoryLibrary();
    const p = await project(lib);
    await p.setRecipe({ recipe: {}, savedAt: 1 });
    await createCheckpoint(p, { recipe: {}, name: "x", now: 1000 });
    await createCheckpoint(p, { recipe: {}, name: "x", now: 1000 });
    const names = files((await writeBundle(p, { includeSource: false, readme: () => "" })).bytes).filter((f) => f.endsWith(".json") && f.includes("checkpoints/"));
    expect(new Set(names).size).toBe(2);
  });

  it("refuses to export a project with no saved settings", async () => {
    const p = await project(memoryLibrary());
    await expect(writeBundle(p, { includeSource: true, readme: () => "" })).rejects.toThrow(BundleError);
  });

  it("reads the folder at the zip root or nested one level, the id from the JSON not the file name", () => {
    const cp = { id: "real-id", createdAt: 5, sourceHash: "h", recipe: {}, name: "", note: "" };
    for (const prefix of ["mona/", "outer/mona/"]) {
      const zip = zipSync({ [`${prefix}recipe.json`]: json({ a: 1 }), [`${prefix}checkpoints/whatever.json`]: json(cp), [`${prefix}checkpoints/whatever.png`]: png(7), "__MACOSX/._x": new Uint8Array([0]) });
      const b = readBundle(zip, { fileName: "x.zip" });
      expect(b.folder).toBe("mona");
      expect(b.recipe).toEqual({ a: 1 });
      expect(b.checkpoints).toEqual([{ file: "whatever.json", json: cp, thumbnail: png(7) }]);
    }
  });

  it("names the project after the zip when its files are at the root", () => {
    const b = readBundle(zipSync({ "recipe.json": json({}) }), { fileName: "Nick's dog.zip" });
    expect(b.folder).toBe("Nick's dog");
  });

  it("refuses something that isn't a zip, a zip without recipe.json, and a recipe.json that isn't JSON", () => {
    expect(() => readBundle(png(1), { fileName: "a.zip" })).toThrow(/isn't a bundle/);
    expect(() => readBundle(zipSync({ "a/notes.txt": strToU8("hi") }), { fileName: "a.zip" })).toThrow(/recipe\.json/);
    expect(() => readBundle(zipSync({ "a/recipe.json": strToU8("{nope") }), { fileName: "a.zip" })).toThrow(/recipe\.json/);
  });

  it("refuses archives bigger than the cap, before unpacking them", () => {
    const zip = zipSync({ "a/recipe.json": json({}), "a/source.png": new Uint8Array(5000) });
    expect(() => readBundle(zip, { fileName: "a.zip", maxBytes: 1000 })).toThrow(/too big/);
    expect(() => readBundle(new Uint8Array(2000), { fileName: "a.zip", maxBytes: 1000 })).toThrow(/too big/);
  });
});

describe("opening a bundle (bundle.ts)", () => {
  it("round trip: export, then import into an empty library gives the same project", async () => {
    const { p } = await filled(memoryLibrary());
    const out = await exportProject(p, { leaveOutSource: false, registry });
    const lib = memoryLibrary();
    const r = await importBundle(lib, out.bytes, { fileName: out.name, parse });
    expect(r).toMatchObject({ created: true, added: 2, already: 0, skipped: 0, fromBundle: false });
    expect(r.project.id).toBe(p.id);
    const q = (await lib.openProject(p.id))!;
    expect(q.name).toBe("mona");
    expect(await q.getSource()).toEqual(await p.getSource());
    expect((await q.getRecipe())!.recipe).toEqual((await p.getRecipe())!.recipe);
    expect(await q.getView()).toEqual(await p.getView());
    expect(byId(await q.listCheckpoints())).toEqual(byId(await p.listCheckpoints()));
    for (const cp of await p.listCheckpoints()) expect(await q.getThumbnail(cp.id)).toEqual(await p.getThumbnail(cp.id));
    expect(importSummary(r)).toBe("Opened mona: 2 checkpoints added.");
  });

  it("merges into an existing project: only new ids are added, the local recipe and view stay", async () => {
    const lib = memoryLibrary();
    const { p, a } = await filled(lib);
    // The bundle's settings are in no checkpoint yet.
    const theirs = { ...fresh(), layout: { ...fresh().layout, marginMm: 25 } };
    await p.setRecipe({ recipe: theirs, savedAt: 50 });
    const bundle = await exportProject(p, { leaveOutSource: false, registry });
    // Locally: the recipe changes, one checkpoint is renamed, one more is saved.
    const local = { ...fresh(), layout: { ...fresh().layout, marginMm: 30 } };
    await p.setRecipe({ recipe: local, savedAt: 99 });
    await p.setView({ version: 1, pins: [] });
    await p.putCheckpoint({ ...a, name: "Renamed here" });
    await createCheckpoint(p, { recipe: local, now: 5 });
    const r = await importBundle(lib, bundle.bytes, { fileName: "mona.zip", parse });
    expect(r).toMatchObject({ created: false, added: 0, already: 2, skipped: 0, fromBundle: true });
    expect((await p.getRecipe())!.recipe).toEqual(local);
    expect(await p.getView()).toEqual({ version: 1, pins: [] });
    expect((await p.getCheckpoint(a.id))!.name).toBe("Renamed here");
    const cps = await listForProject(p);
    expect(cps).toHaveLength(4);
    const from = cps.find((c) => c.name === FROM_BUNDLE)!;
    expect(from.note).toBe("mona.zip");
    expect(from.recipe).toEqual(theirs);
    expect(importSummary(r)).toBe(`Opened mona.jpg: no checkpoints added, 2 already here. The bundle's current settings differ from yours, so they're saved as the checkpoint “${FROM_BUNDLE}”.`);
    // Opening it again adds nothing more.
    const again = await importBundle(lib, bundle.bytes, { fileName: "mona.zip", parse });
    expect(again).toMatchObject({ added: 0, already: 2, fromBundle: false });
    expect(await listForProject(p)).toHaveLength(4);
  });

  it("an existing project with the same recipe gets no “From bundle” checkpoint", async () => {
    const lib = memoryLibrary();
    const { p } = await filled(lib);
    const bundle = await exportProject(p, { leaveOutSource: false, registry });
    const r = await importBundle(lib, bundle.bytes, { fileName: "mona.zip", parse });
    expect(r).toMatchObject({ added: 0, already: 2, fromBundle: false });
  });

  it("a bundle without its image merges into the project if it's here", async () => {
    const home = memoryLibrary();
    const { p } = await filled(home);
    const bundle = await exportProject(p, { leaveOutSource: true, registry });
    expect(files(bundle.bytes).some((f) => f.includes("source."))).toBe(false);
    const lib = memoryLibrary();
    const q = await project(lib);
    const r = await importBundle(lib, bundle.bytes, { fileName: bundle.name, parse });
    expect(r).toMatchObject({ created: false, added: 2, already: 0 });
    expect(await q.listCheckpoints()).toHaveLength(2);
    expect((await q.getRecipe())!.recipe).toEqual(fresh());
  });

  it("a bundle without its image, for a project that isn't here, is refused and writes nothing", async () => {
    const { p } = await filled(memoryLibrary());
    const bundle = await exportProject(p, { leaveOutSource: true, registry });
    const lib = memoryLibrary();
    await expect(importBundle(lib, bundle.bytes, { fileName: bundle.name, parse })).rejects.toThrow("This bundle leaves out its image. Open the image first, then open the bundle again.");
    expect(await lib.listProjects()).toEqual([]);
  });

  it("skips and counts checkpoints that can't be read; reads the rest", async () => {
    const id = await sha256Hex(jpeg);
    const good = { id: "g1", createdAt: 1, sourceHash: id, recipe: fresh(), name: "ok", note: "" };
    const zip = zipSync({
      "m/source.jpg": jpeg,
      "m/recipe.json": json(fresh()),
      "m/checkpoints/1.json": json(good),
      "m/checkpoints/2.json": strToU8("{broken"),
      "m/checkpoints/3.json": json({ ...good, id: "g2", recipe: { schemaVersion: 999 } }),
      "m/checkpoints/4.json": json({ ...good, id: 7 }),
    });
    const lib = memoryLibrary();
    const r = await importBundle(lib, zip, { fileName: "m.zip", parse });
    expect(r).toMatchObject({ created: true, added: 1, skipped: 3 });
    expect(importSummary(r)).toBe("Opened m: 1 checkpoint added, 3 couldn't be read and were left out.");
    expect((await (await lib.openProject(id))!.listCheckpoints()).map((c) => c.id)).toEqual(["g1"]);
  });

  it("refuses a bundle whose recipe.json can't be read, and writes nothing", async () => {
    const zip = zipSync({ "m/source.jpg": jpeg, "m/recipe.json": json({ schemaVersion: 999 }) });
    const lib = memoryLibrary();
    await expect(importBundle(lib, zip, { fileName: "m.zip", parse })).rejects.toThrow(/settings \(recipe\.json\) can't be read/);
    expect(await lib.listProjects()).toEqual([]);
  });

  it("stores recipes upgraded (ADR 0002)", async () => {
    const old = { ...defaultRecipe(), schemaVersion: 3 } as Record<string, unknown>;
    delete old.screenAngles;
    const zip = zipSync({ "m/source.jpg": jpeg, "m/recipe.json": json(old) });
    const lib = memoryLibrary();
    const r = await importBundle(lib, zip, { fileName: "m.zip", parse });
    const saved = (await (await lib.openProject(r.project.id))!.getRecipe())!.recipe as { schemaVersion: number };
    expect(saved.schemaVersion).toBe(fresh().schemaVersion);
  });

  it("README: steps and settings in plain words, the CLI command, the version", () => {
    const text = bundleReadme({ name: "mona", recipe: fresh(), source: "source.jpg", registry, version: "9.9.9" });
    for (const step of fresh().steps) expect(text).toContain(registry.get(step.step)!.title);
    expect(text).toContain("plotlab run recipe.json -i source.jpg -o out/");
    expect(text).toContain("9.9.9");
    expect(bundleReadme({ name: "mona", recipe: fresh(), source: null, registry, version: "1" })).toContain("-i <your image>");
  });
});
