/**
 * Saves data as a file: a blob and a link, which every browser (Safari and iOS too) supports.
 * The link is in the page while it's clicked (Firefox wants that), and the blob URL is kept
 * for a minute, since older iOS Safari hands the download over slowly.
 */
export function download(name: string, data: string | Uint8Array, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
