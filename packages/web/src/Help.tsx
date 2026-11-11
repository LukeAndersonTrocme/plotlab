/** Tiny markdown subset (headings, bold, italics, lists, paragraphs); help files are ours. */
function inline(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/&lt;!--[\s\S]*?--&gt;/g, "")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list = false;
  for (const block of md.replace(/<!--[\s\S]*?-->/g, "").split(/\n{2,}/)) {
    const lines = block.trim().split("\n");
    if (lines.every((l) => l.startsWith("- "))) {
      if (!list) out.push("<ul>");
      list = true;
      for (const l of lines) out.push(`<li>${inline(l.slice(2))}</li>`);
      continue;
    }
    if (list) out.push("</ul>");
    list = false;
    const h = block.match(/^(#{1,3}) (.*)$/);
    if (h) out.push(`<h${h[1]!.length + 2}>${inline(h[2]!)}</h${h[1]!.length + 2}>`);
    else if (block.trim()) {
      // A paragraph followed by a list in the same block.
      const idx = lines.findIndex((l) => l.startsWith("- "));
      if (idx > 0) {
        out.push(`<p>${inline(lines.slice(0, idx).join(" "))}</p><ul>`);
        for (const l of lines.slice(idx)) out.push(`<li>${inline(l.replace(/^- /, ""))}</li>`);
        out.push("</ul>");
      } else out.push(`<p>${inline(lines.join(" "))}</p>`);
    }
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

export function HelpPanel(props: { markdown: string; onClose: () => void }) {
  return (
    <aside className="help" role="dialog">
      <button className="close" onClick={props.onClose} aria-label="Close help">
        ×
      </button>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(props.markdown) }} />
    </aside>
  );
}
