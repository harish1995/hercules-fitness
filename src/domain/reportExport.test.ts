import { describe, expect, it } from 'vitest';
import { type Page, type PageCursor } from '../types/member';
import { CSV_BOM } from './csv';
import { ExportCancelledError, runCsvExport, type ExportProgress } from './reportExport';
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE } from './reports';

/**
 * US-8.1 / US-6.2d,f: the paged export loop. The page source is a fake with `total` rows that, like the services, returns a `next`
 * cursor exactly when MORE rows exist beyond the requested size.
 */
const cursor = (n: number) => n as unknown as PageCursor;
function source(total: number) {
  const calls: number[] = [];
  const fetchPage = async (c: PageCursor | null, size: number): Promise<Page<number>> => {
    const from = (c as unknown as number | null) ?? 0;
    calls.push(size);
    const items = Array.from({ length: Math.min(size, total - from) }, (_v, i) => from + i);
    const next = from + size < total ? cursor(from + size) : null;
    return { items, next };
  };
  return { fetchPage, calls };
}
const lines = (chunks: string[]) => chunks.join('').replace(CSV_BOM, '').split('\r\n').filter(Boolean);

describe('the cap', () => {
  it('defaults are 5,000 rows in pages of 250', () => {
    expect(EXPORT_MAX_ROWS).toBe(5000);
    expect(EXPORT_PAGE_SIZE).toBe(250);
  });

  it('fewer rows than the cap: everything is exported and it is not truncated', async () => {
    const s = source(7);
    const r = await runCsvExport({ header: ['n'], fetchPage: s.fetchPage, toRow: (n) => [n], maxRows: 10, pageSize: 3 });
    expect(r).toMatchObject({ rowCount: 7, truncated: false });
    expect(lines(r.chunks)).toEqual(['n', '0', '1', '2', '3', '4', '5', '6']);
    expect(r.chunks[0]?.startsWith(CSV_BOM)).toBe(true);
  });

  it('EXACTLY the cap: not truncated (the reader asks for one more than the cap allows before deciding)', async () => {
    const r = await runCsvExport({ header: ['n'], fetchPage: source(10).fetchPage, toRow: (n) => [n], maxRows: 10, pageSize: 4 });
    expect(r).toMatchObject({ rowCount: 10, truncated: false });
  });

  it('one row more than the cap: the first `cap` rows, truncated', async () => {
    const r = await runCsvExport({ header: ['n'], fetchPage: source(11).fetchPage, toRow: (n) => [n], maxRows: 10, pageSize: 4 });
    expect(r).toMatchObject({ rowCount: 10, truncated: true });
    expect(lines(r.chunks)).toHaveLength(11); // header + 10
  });

  it('never asks for more than the remaining cap in one page (no unbounded read) and pages in the requested size', async () => {
    const s = source(1000);
    await runCsvExport({ header: ['n'], fetchPage: s.fetchPage, toRow: (n) => [n], maxRows: 10, pageSize: 4 });
    expect(s.calls).toEqual([4, 4, 2]);
    const big = source(100_000);
    await runCsvExport({ header: ['n'], fetchPage: big.fetchPage, toRow: (n) => [n] });
    expect(Math.max(...big.calls)).toBeLessThanOrEqual(EXPORT_PAGE_SIZE);
    expect(big.calls.reduce((a, b) => a + b, 0)).toBe(EXPORT_MAX_ROWS);
  });

  it('an empty result is a file with just the header', async () => {
    const r = await runCsvExport({ header: ['a', 'b'], fetchPage: source(0).fetchPage, toRow: (n) => [n], maxRows: 10 });
    expect(r).toMatchObject({ rowCount: 0, truncated: false });
    expect(lines(r.chunks)).toEqual(['a,b']);
  });
});

describe('cancel and failure never produce a partial file (US-6.2f)', () => {
  it('an abort before the first page rejects', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runCsvExport({ header: ['n'], fetchPage: source(5).fetchPage, toRow: (n) => [n], signal: ac.signal })).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('an abort between pages rejects: the caller receives no chunks at all', async () => {
    const ac = new AbortController();
    const s = source(100);
    const p = runCsvExport({
      header: ['n'],
      fetchPage: async (c, size) => {
        const page = await s.fetchPage(c, size);
        if (s.calls.length === 2) ac.abort();
        return page;
      },
      toRow: (n) => [n],
      pageSize: 10,
      signal: ac.signal,
    });
    await expect(p).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('a failing page rejects with the original error', async () => {
    await expect(
      runCsvExport({
        header: ['n'],
        fetchPage: async () => {
          throw new Error('network down');
        },
        toRow: (n: number) => [n],
      }),
    ).rejects.toThrow('network down');
  });
});

describe('progress and content safety', () => {
  it('reports progress starting at 0 and ending at the row count, with the cap', async () => {
    const seen: ExportProgress[] = [];
    await runCsvExport({ header: ['n'], fetchPage: source(5).fetchPage, toRow: (n) => [n], maxRows: 10, pageSize: 2, onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ rows: 0, cap: 10 });
    expect(seen[seen.length - 1]).toEqual({ rows: 5, cap: 10 });
  });

  it('every row goes through the CSV encoder: injection is neutralized inside an export', async () => {
    const r = await runCsvExport({
      header: ['name'],
      fetchPage: async () => ({ items: ['=HYPERLINK("x")', '@sum', 'ok'], next: null }),
      toRow: (n: string) => [n],
      maxRows: 10,
    });
    expect(lines(r.chunks)).toEqual(['name', '"\'=HYPERLINK(""x"")"', "'@sum", 'ok']);
  });
});
