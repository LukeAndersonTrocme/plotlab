import { useEffect, useState } from "react";
import { checkpointLabel, checkpointTime as when, deleteCheckpoint, listAllGrouped, listForProject, updateCheckpoint, type CheckpointGroup } from "./checkpoints.ts";
import { ExportBundle, OpenBundle } from "./BundleControls.tsx";
import type { ImportResult } from "./bundle.ts";
import { estimateStorage, storageWarning, type Checkpoint, type Library, type ProjectStore } from "./storage/index.ts";

/** `version` changes when a picture may have arrived (it's drawn after the checkpoint is saved). */
function Thumb(props: { project: ProjectStore; id: string; version: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let u: string | undefined;
    void props.project.getThumbnail(props.id).then((bytes) => {
      if (!alive || !bytes) return;
      u = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [props.project, props.id, props.version]);
  return url ? <img src={url} alt="" /> : <span className="ckpt-nothumb">no preview</span>;
}

function Item(props: { project: ProjectStore; cp: Checkpoint; version: number; onRestore: () => void; onChanged: () => void; onDelete: () => void }) {
  const { cp, project } = props;
  const [renaming, setRenaming] = useState(false);
  const [noting, setNoting] = useState(false);
  const label = checkpointLabel(cp);
  const save = async (patch: { name?: string; note?: string }) => {
    await updateCheckpoint(project, cp.id, patch);
    props.onChanged();
  };
  return (
    <li className="ckpt">
      <button className="ckpt-thumb" onClick={props.onRestore} title={`Go back to “${label}”. Where you are now is saved first.`} aria-label={`Restore ${label}`}>
        <Thumb project={project} id={cp.id} version={props.version} />
      </button>
      <div className="ckpt-meta">
        {renaming ? (
          <input
            className="text ckpt-rename"
            autoFocus
            defaultValue={cp.name}
            placeholder={when(cp.createdAt)}
            aria-label="Checkpoint name"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={(e) => {
              setRenaming(false);
              if (e.currentTarget.value.trim() !== cp.name) void save({ name: e.currentTarget.value });
            }}
          />
        ) : (
          <button className="link ckpt-name" onClick={() => setRenaming(true)} title="Rename">
            {label}
          </button>
        )}
        <span className="ckpt-tools">
          <button className="icon" onClick={() => setNoting(!noting)} title={cp.note ? "Edit the note" : "Add a note"} aria-label="Note">
            ✎
          </button>
          <button className="icon" onClick={props.onDelete} title="Delete this checkpoint" aria-label="Delete checkpoint">
            ×
          </button>
        </span>
      </div>
      {cp.name && <div className="ckpt-when">{when(cp.createdAt)}</div>}
      {noting ? (
        <textarea
          className="ckpt-note-edit"
          autoFocus
          rows={3}
          defaultValue={cp.note}
          placeholder="What's this one for?"
          aria-label="Checkpoint note"
          onBlur={(e) => {
            setNoting(false);
            if (e.currentTarget.value !== cp.note) void save({ note: e.currentTarget.value });
          }}
        />
      ) : (
        cp.note && <div className="ckpt-note">{cp.note}</div>
      )}
    </li>
  );
}

/**
 * The checkpoints sidebar (right edge; a bottom drawer on phones). `S` toggles it (the app's
 * shortcuts, keys.ts). Shows
 * the open project's checkpoints, or checkpoints across projects, grouped by image; at the
 * bottom, the project as a bundle (ADR 0014): Export project and Open a bundle.
 * Swipe-to-delete on phones is left for the mobile pass (#46).
 */
export function CheckpointSidebar(props: {
  open: boolean;
  onToggle: () => void;
  library: Library | null;
  project: ProjectStore | null;
  persistent: boolean;
  /** Bumped after a save so the list reloads. */
  version: number;
  onSave: () => void;
  onRestore: (cp: Checkpoint) => void;
  onNotice: (message: string) => void;
  /** A bundle was opened into the library (its project may be another one). */
  onBundleOpened: (result: ImportResult, message: string) => void;
}) {
  const { library, project } = props;
  const [showAll, setShowAll] = useState(false);
  const [groups, setGroups] = useState<CheckpointGroup[]>([]);
  const [reload, setReload] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ project: ProjectStore; cp: Checkpoint; thumb: Uint8Array | undefined } | null>(null);

  useEffect(() => {
    if (!props.open || !library || !project) return;
    let alive = true;
    const load = showAll ? listAllGrouped(library, project.id) : listForProject(project).then((checkpoints) => [{ project, checkpoints }]);
    void load.then((g) => alive && setGroups(g)).catch(() => {});
    void estimateStorage().then((e) => alive && setWarning(storageWarning(e)));
    return () => {
      alive = false;
    };
  }, [props.open, library, project, showAll, props.version, reload]);

  if (!props.open) return null;
  const changed = () => setReload((n) => n + 1);
  const remove = async (p: ProjectStore, cp: Checkpoint) => {
    const thumb = await p.getThumbnail(cp.id);
    await deleteCheckpoint(p, cp.id);
    setDeleted({ project: p, cp, thumb });
    changed();
  };
  const undoDelete = async () => {
    if (!deleted) return;
    await deleted.project.putCheckpoint(deleted.cp, deleted.thumb);
    setDeleted(null);
    changed();
  };
  const empty = groups.every((g) => g.checkpoints.length === 0);

  return (
    <aside className="ckpt-sidebar" aria-label="Checkpoints">
      <div className="ckpt-head">
        <strong>Checkpoints</strong>
        <button className="icon" onClick={props.onToggle} title="Close (S)" aria-label="Close checkpoints">
          ×
        </button>
      </div>
      <p className="ckpt-explain">A checkpoint is a saved copy of your settings. Click one to go back to it; where you are now is saved first, so nothing is lost.</p>
      <button className="primary ckpt-save" onClick={props.onSave} disabled={!project} title="Save the current settings as a checkpoint (⌘S)">
        ＋ Save checkpoint
      </button>
      <label className="toggle ckpt-all" title="Show checkpoints across all your projects, grouped by image">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
      </label>
      {!props.persistent && <div className="hint">This browser isn't allowing storage (private mode?), so checkpoints last only until you reload or close the tab.</div>}
      {warning && <div className="hint ckpt-warn">{warning}</div>}
      {deleted && (
        <div className="hint">
          Deleted “{checkpointLabel(deleted.cp)}”.{" "}
          <button className="link" onClick={() => void undoDelete()}>
            Undo
          </button>
        </div>
      )}
      <div className="ckpt-scroll">
        {empty && <div className="hint">No checkpoints {showAll ? "yet" : "for this image yet"}. Save checkpoint (⌘S) saves the current settings with a small picture.</div>}
        {groups
          .filter((g) => g.checkpoints.length)
          .map((g) => (
            <section key={g.project.id} className="ckpt-group">
              {showAll && (
                <h3>
                  {g.project.name}
                  {g.project.id === project?.id && <span className="ckpt-current"> · current</span>}
                </h3>
              )}
              <ul>
                {g.checkpoints.map((cp) => (
                  <Item key={cp.id} project={g.project} cp={cp} version={props.version} onRestore={() => props.onRestore(cp)} onChanged={changed} onDelete={() => void remove(g.project, cp)} />
                ))}
              </ul>
            </section>
          ))}
      </div>
      <section className="bundle" aria-label="Bundle">
        <h3>Move or share this project</h3>
        <ExportBundle project={project} onNotice={props.onNotice} />
        <OpenBundle library={library} onOpened={props.onBundleOpened} onError={props.onNotice} />
      </section>
    </aside>
  );
}
