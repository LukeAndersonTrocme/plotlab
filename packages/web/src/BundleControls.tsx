import { useId, useState } from "react";
import { loadRecipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { BundleError, exportProject, importBundle, importSummary, MAX_BUNDLE_BYTES, sizeLimitText, type ImportResult } from "./bundle.ts";
import { download } from "./download.ts";
import type { Library, ProjectStore } from "./storage/index.ts";

const registry = createRegistry();
const parse = (json: unknown) => loadRecipe(json, registry).recipe;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the Open a bundle button and a dropped .zip say before the projects have loaded. */
export const STILL_LOADING = "Your projects are still loading. Try again in a moment.";

/** Reads a chosen .zip and opens it into the library. Throws a plain-words error. */
export async function openBundleFile(library: Library, file: File): Promise<{ result: ImportResult; message: string }> {
  if (file.size > MAX_BUNDLE_BYTES) throw new BundleError(`${file.name} is too big to open (over ${sizeLimitText(MAX_BUNDLE_BYTES)}).`);
  const result = await importBundle(library, new Uint8Array(await file.arrayBuffer()), { fileName: file.name, parse });
  const keep = library.persistent ? "" : " This browser isn't allowing storage (private mode?), so it lasts only until you close the tab.";
  return { result, message: importSummary(result) + keep };
}

/** Export project: downloads `<project>.zip` (ADR 0014), with the source image unless left out. */
export function ExportBundle(props: { project: ProjectStore | null; onNotice: (m: string) => void }) {
  const [leaveOut, setLeaveOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!props.project) return;
    setBusy(true);
    try {
      const out = await exportProject(props.project, { leaveOutSource: leaveOut, registry });
      download(out.name, out.bytes, "application/zip");
      props.onNotice(`Exported ${out.name}${leaveOut ? ", without the source image" : ""}. Open it in plotlab on another device (Open a bundle) to see this project there.`);
    } catch (e) {
      props.onNotice(`Couldn't export this project: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bundle-export">
      <button className="bundle-btn" onClick={() => void go()} disabled={!props.project || busy} title="Download this project (image, settings and checkpoints) as one .zip file, to move it to another device or share it">
        {busy ? "Exporting…" : "Export project (.zip)"}
      </button>
      <label className="toggle bundle-leave" title="Leave the image out, for when it isn't yours to share. Whoever opens the bundle needs their own copy of it.">
        <input type="checkbox" checked={leaveOut} onChange={(e) => setLeaveOut(e.target.checked)} /> Leave out source image
      </label>
    </div>
  );
}

/** Open a bundle: a .zip file picker. Every outcome ends in a message, never a stuck "Opening…". */
export function OpenBundle(props: { library: Library | null; onOpened: (r: ImportResult, message: string) => void; onError: (m: string) => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const id = useId();
  const open = async (file: File) => {
    if (!props.library) return props.onError(STILL_LOADING);
    setBusy(true);
    try {
      const { result, message } = await openBundleFile(props.library, file);
      props.onOpened(result, message);
    } catch (e) {
      props.onError(e instanceof BundleError ? e.message : `Couldn't open ${file.name}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={props.className ?? "bundle-open"}>
      <label htmlFor={id} className={busy ? "bundle-btn busy" : "bundle-btn"} title="Open a project saved as a .zip (an exported bundle). Its checkpoints are added to what's here; nothing is overwritten.">
        {busy ? "Opening…" : "Open a bundle…"}
      </label>
      <input
        id={id}
        className="bundle-file"
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        disabled={busy}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = ""; // the same file can be chosen again
          if (f) void open(f);
        }}
      />
    </span>
  );
}
