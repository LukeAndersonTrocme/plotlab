import { useEffect, useRef, useState } from "react";
import { deleteCheckpoint, listAllGrouped, listForSource, updateCheckpoint, type CheckpointGroup } from "./checkpoints.ts";
import { estimateStorage, storageWarning, type Checkpoint, type ProjectStore, type SourceHash } from "./storage/index.ts";

/** True when a key press belongs to a text field, not to the app's shortcuts. */
function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "color", "file"].includes(t.type);
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Thumb(props: { store: ProjectStore; id: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let u: string | undefined;
    void props.store.getThumbnail(props.id).then((bytes) => {
      if (!alive || !bytes) return;
      u = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [props.store, props.id]);
  return url ? <img src={url} alt="" /> : <span className="ckpt-nothumb">no preview</span>;
}

function Item(props: { store: ProjectStore; cp: Checkpoint; onRestore: () => void; onChanged: () => void; onDelete: () => void }) {
  const { cp, store } = props;
  const [renaming, setRenaming] = useState(false);
  const [noting, setNoting] = useState(false);
  const label = cp.name || when(cp.createdAt);
  const save = async (patch: { name?: string; note?: string }) => {
    await updateCheckpoint(store, cp.id, patch);
    props.onChanged();
  };
  return (
    <li className="ckpt">
      <button className="ckpt-thumb" onClick={props.onRestore} title={`Restore “${label}” (Back undoes it)`} aria-label={`Restore ${label}`}>
        <Thumb store={store} id={cp.id} />
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
 * The checkpoints sidebar (right edge; a bottom drawer on phones). `S` toggles it. Shows
 * the current source's checkpoints, or all of them grouped by source.
 * Swipe-to-delete on phones is left for the mobile pass (#46).
 */
export function CheckpointSidebar(props: {
  open: boolean;
  onToggle: () => void;
  store: ProjectStore | null;
  persistent: boolean;
  sourceHash: SourceHash;
  sourceName: string;
  /** Bumped after a save so the list reloads. */
  version: number;
  onSave: () => void;
  onRestore: (cp: Checkpoint, group: CheckpointGroup) => void;
}) {
  const { store, sourceHash } = props;
  const [showAll, setShowAll] = useState(false);
  const [groups, setGroups] = useState<CheckpointGroup[]>([]);
  const [reload, setReload] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ cp: Checkpoint; thumb: Uint8Array | undefined } | null>(null);

  const toggle = useRef(props.onToggle);
  toggle.current = props.onToggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "s" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      toggle.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!props.open || !store) return;
    let alive = true;
    const load = showAll
      ? listAllGrouped(store, sourceHash)
      : listForSource(store, sourceHash).then((checkpoints) => [{ sourceHash, name: props.sourceName, available: true, checkpoints }]);
    void load.then((g) => alive && setGroups(g));
    void estimateStorage().then((e) => alive && setWarning(storageWarning(e)));
    return () => {
      alive = false;
    };
  }, [props.open, store, sourceHash, props.sourceName, showAll, props.version, reload]);

  if (!props.open) return null;
  const changed = () => setReload((n) => n + 1);
  const remove = async (cp: Checkpoint) => {
    if (!store) return;
    const thumb = await store.getThumbnail(cp.id);
    await deleteCheckpoint(store, cp.id);
    setDeleted({ cp, thumb });
    changed();
  };
  const undoDelete = async () => {
    if (!store || !deleted) return;
    await store.putCheckpoint(deleted.cp, deleted.thumb);
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
      <button className="primary ckpt-save" onClick={props.onSave} disabled={!store}>
        ＋ Checkpoint
      </button>
      <label className="toggle ckpt-all" title="Show the checkpoints of every image, grouped by image">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
      </label>
      {!props.persistent && <div className="hint">This browser isn't allowing storage (private mode?), so checkpoints last only until you reload or close the tab.</div>}
      {warning && <div className="hint ckpt-warn">{warning}</div>}
      {deleted && (
        <div className="hint">
          Deleted “{deleted.cp.name || when(deleted.cp.createdAt)}”.{" "}
          <button className="link" onClick={() => void undoDelete()}>
            Undo
          </button>
        </div>
      )}
      <div className="ckpt-scroll">
        {empty && <div className="hint">No checkpoints {showAll ? "yet" : "for this image yet"}. ＋ Checkpoint saves the current settings with a small picture.</div>}
        {groups
          .filter((g) => g.checkpoints.length)
          .map((g) => (
            <section key={g.sourceHash} className="ckpt-group">
              {showAll && (
                <h3 title={g.available ? undefined : "This image is no longer stored; restoring keeps the current image."}>
                  {g.name}
                  {g.sourceHash === sourceHash && <span className="ckpt-current"> · current</span>}
                </h3>
              )}
              <ul>
                {store &&
                  g.checkpoints.map((cp) => (
                    <Item key={cp.id} store={store} cp={cp} onRestore={() => props.onRestore(cp, g)} onChanged={changed} onDelete={() => void remove(cp)} />
                  ))}
              </ul>
            </section>
          ))}
      </div>
    </aside>
  );
}
