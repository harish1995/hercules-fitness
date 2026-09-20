/**
 * Hand a text file to the browser as a download, with no server involved (Render serves a static site): a Blob, an object URL
 * and a temporary `<a download>` click. `chunks` are joined by the Blob in order; the first chunk carries the UTF-8 BOM (which the
 * Blob's UTF-8 encoding turns into the bytes EF BB BF) so Excel opens `₹` and Indian-script names correctly.
 */
export function downloadTextFile(fileName: string, chunks: readonly string[], mimeType = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([...chunks], { type: mimeType }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // the click starts the download synchronously; revoke a moment later so browsers that read the URL lazily still can
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
