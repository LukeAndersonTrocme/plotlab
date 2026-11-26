import { describe, expect, it } from "vitest";
import { enterAt, type Recipe } from "@plotlab/engine";
import { applyPreset, createRegistry, presets } from "@plotlab/steps";
import { defaultRecipe } from "../src/defaults.ts";
import { galleryItems, pickPreset, presetChange } from "../src/gallery.ts";
import { listForProject } from "../src/checkpoints.ts";
import { memoryLibrary, type ProjectStore } from "../src/storage/index.ts";

const registry = createRegistry();
const fitImage = (r: Recipe) => ({ recipe: enterAt(r, "image", registry).recipe, note: null });
async function project(): Promise<ProjectStore> {
  const lib = memoryLibrary();
  return (await lib.openProject((await lib.createProject({ bytes: new Uint8Array([1]), name: "mona-lisa.jpg", type: "image/jpeg" })).id))!;
}
const title = (id: string) => presets.find((p) => p.id === id)!.title;

describe("preset gallery", () => {
  it("has one picture per preset, each the preset's recipe fitted to your picture and page", () => {
    const current = { ...defaultRecipe(), paper: { widthMm: 210, heightMm: 297 } };
    const items = galleryItems(current, fitImage);
    expect(items.map((i) => i.id)).toEqual(presets.map((p) => p.id));
    for (const i of items) {
      expect(i.recipe.steps.map((s) => s.step)).toEqual(presets.find((p) => p.id === i.id)!.steps.map((s) => s.step));
      // Drawn on your page, not a stock one.
      expect(i.recipe.paper).toEqual(current.paper);
    }
  });

  it("says which presets also change the output", () => {
    const items = galleryItems(defaultRecipe(), fitImage);
    expect(items.find((i) => i.id === "atkinson-print")!.change).toBe("Switches the output to Print prep");
    expect(items.find((i) => i.id === "topo-hatch")!.change).toBeNull();
  });

  it("describes a target change in plain words", () => {
    const plotter = defaultRecipe();
    const print = applyPreset(plotter, "atkinson-print");
    expect(presetChange(plotter, plotter)).toBeNull();
    expect(presetChange(plotter, print)).toBe("Switches the output to Print prep");
    const otherPrint = { ...print, target: { ...print.target, dpi: 1200 } } as Recipe;
    expect(presetChange(otherPrint, print)).toBe("Changes the Print prep settings");
  });
});

describe("picking a preset", () => {
  it("saves the current recipe as a checkpoint first, then replaces the steps", async () => {
    const p = await project();
    const current = defaultRecipe();
    const r = await pickPreset(p, current, "topo-hatch", fitImage, 10);
    expect(r.recipe.steps.map((s) => s.step)).toEqual(presets.find((x) => x.id === "topo-hatch")!.steps.map((s) => s.step));
    const saved = await listForProject(p);
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ recipe: current, name: `Before “${title("topo-hatch")}”`, createdAt: 10 });
    expect(r.saved?.checkpoint.id).toBe(saved[0]!.id);
    expect(r.message).toBe(`Applied “${title("topo-hatch")}”. Your previous settings are saved as a checkpoint.`);
  });

  it("a preset with a target keeps you on it, and says so", async () => {
    const r = await pickPreset(await project(), defaultRecipe(), "atkinson-print", fitImage);
    expect(r.recipe.target.kind).toBe("print");
    expect(r.message).toBe(`Applied “${title("atkinson-print")}” and switched the output to Print prep. Your previous settings are saved as a checkpoint.`);
  });

  it("doesn't save the same recipe twice (picking presets one after another)", async () => {
    const p = await project();
    const a = await pickPreset(p, defaultRecipe(), "topo-hatch", fitImage);
    await pickPreset(p, defaultRecipe(), "contours", fitImage);
    expect((await listForProject(p)).length).toBe(1);
    const b = await pickPreset(p, a.recipe, "contours", fitImage);
    expect((await listForProject(p)).length).toBe(2);
    expect(b.saved?.created).toBe(true);
  });

  it("says what the source changed, after the rest", async () => {
    const fit = (r: Recipe) => ({ recipe: r, note: "An SVG enters as lines." });
    const r = await pickPreset(await project(), defaultRecipe(), "topo-hatch", fit);
    expect(r.message).toBe(`Applied “${title("topo-hatch")}”. Your previous settings are saved as a checkpoint.\nAn SVG enters as lines.`);
  });

  it("without storage, applies anyway and says Back undoes it", async () => {
    const r = await pickPreset(null, defaultRecipe(), "topo-hatch", fitImage);
    expect(r.saved).toBeNull();
    expect(r.message).toBe(`Applied “${title("topo-hatch")}”. Checkpoints are off, so it wasn't saved first: Back undoes this.`);
  });

  it("if saving first fails, the preset isn't applied", async () => {
    const p = await project();
    const broken: ProjectStore = { ...p, putCheckpoint: async () => Promise.reject(new Error("disk full")) };
    await expect(pickPreset(broken, defaultRecipe(), "topo-hatch", fitImage)).rejects.toThrow("disk full");
  });
});
