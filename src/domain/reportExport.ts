import { type Page, type PageCursor } from '../types/member';
import { CSV_BOM, encodeCsvRows, type CsvCell } from './csv';
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE } from './reports';

/**
 * The paged CSV export loop (architecture §5.7, US-6.2d/f). Firebase-free: the page source is a callback, so the cap, the
 * cancel, the progress and the "no partial file" rules are unit-testable without a database.
 *
 *   - Rows are fetched in pages of `pageSize`, never as one unbounded read, and the loop stops at `maxRows`.
 *   - `fetchPage(cursor, size)` must return a page with `next !== null` exactly when MORE rows exist beyond `size` (the
 *     services read `size + 1` documents for that), so `truncated` is exact: it is true only if rows were really left out.
 *   - Cancelling (AbortSignal) or any failure rejects: the caller gets NO file, so a partial file can never be offered as complete.
 */

export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'ExportCancelledError';
  }
}

export interface ExportProgress {
  /** rows fetched so far */
  rows: number;
  /** the most rows the export will contain */
  cap: number;
}

export interface CsvExportResult {
  /** the CSV in pieces, BOM first: `new Blob(chunks)` */
  chunks: string[];
  rowCount: number;
  /** more rows matched than the cap allows: the file holds the first `rowCount` only */
  truncated: boolean;
}

export interface CsvExportOptions<T> {
  header: readonly CsvCell[];
  fetchPage: (cursor: PageCursor | null, size: number) => Promise<Page<T>>;
  toRow: (item: T) => readonly CsvCell[];
  maxRows?: number;
  pageSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export async function runCsvExport<T>(opts: CsvExportOptions<T>): Promise<CsvExportResult> {
  const cap = opts.maxRows ?? EXPORT_MAX_ROWS;
  const pageSize = opts.pageSize ?? EXPORT_PAGE_SIZE;
  const chunks: string[] = [CSV_BOM + encodeCsvRows([opts.header])];
  const checkCancelled = () => {
    if (opts.signal?.aborted) throw new ExportCancelledError();
  };

  let rows = 0;
  let truncated = false;
  let cursor: PageCursor | null = null;
  opts.onProgress?.({ rows, cap });
  for (;;) {
    checkCancelled();
    const size = Math.min(pageSize, cap - rows);
    const page: Page<T> = await opts.fetchPage(cursor, size);
    checkCancelled(); // a cancel during the read: discard what it returned
    const items = page.items.slice(0, size);
    chunks.push(encodeCsvRows(items.map(opts.toRow)));
    rows += items.length;
    opts.onProgress?.({ rows, cap });
    if (page.next === null || items.length === 0) break;
    if (rows >= cap) {
      truncated = true;
      break;
    }
    cursor = page.next;
  }
  return { chunks, rowCount: rows, truncated };
}
