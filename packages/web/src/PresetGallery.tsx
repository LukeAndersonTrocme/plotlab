import { useEffect, useRef, type KeyboardEvent } from "react";
import { trapTab } from "./keys.ts";
import type { GalleryItem } from "./gallery.ts";
import { useBlobUrl } from "./StageView.tsx";

/** "drawing" until the worker sends the picture; null when this preset can't be drawn on the source. */
export type GalleryThumb = Blob | null | "drawing";

function Picture(props: { thumb: GalleryThumb }) {
  const url = useBlobUrl(props.thumb instanceof Blob ? props.thumb : undefined);
  if (url) return <img src={url} alt="" />;
  return <span className="look-wait">{props.thumb === null ? "Can't preview on this image" : "Drawing…"}</span>;
}

/**
 * The preset gallery: each preset drawn on your own picture (the strip's thumbnail renderer,
 * in the worker). Picking one saves your current settings as a checkpoint, then replaces the steps.
 * A modal dialog: the focus comes in on open, Tab stays inside (`trapTab`), Escape closes it
 * (one handler, on the dialog itself, so it can't fire while the editor is hidden), and the
 * focus goes back where it was (the Presets button).
 */
export function PresetGallery(props: { items: GalleryItem[]; thumbs: Record<string, GalleryThumb>; onPick: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>("button.look")?.focus();
    return () => {
      if (back?.isConnected) back.focus();
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
    const active = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
    const next = trapTab(items, active, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="gallery-title" ref={dialog} tabIndex={-1} onKeyDown={onKey}>
        <div className="modal-head">
          <div>
            <h2 id="gallery-title">Presets</h2>
            <p className="hint">Each preset is a ready-made set of steps, shown here on your picture. Picking one replaces your steps; your current settings are saved as a checkpoint first.</p>
          </div>
          <button onClick={props.onClose} aria-label="Close presets">
            Close
          </button>
        </div>
        <div className="gallery">
          {props.items.map((p) => (
            <button key={p.id} className="look" data-preset={p.id} onClick={() => props.onPick(p.id)} title={`Use “${p.title}”`}>
              <span className="look-pic">
                <Picture thumb={props.thumbs[p.id] ?? "drawing"} />
              </span>
              <span className="look-title">{p.title}</span>
              <span className="look-summary">{p.summary}</span>
              {p.change && <span className="look-change">{p.change}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
