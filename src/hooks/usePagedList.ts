import { useCallback, useState } from 'react';
import { type Page, type PageCursor } from '../types/member';
import { useAsyncData, type AsyncStatus } from './useAsyncData';

interface PagerState {
  key: string;
  pageIndex: number;
  /** cursors[i] is the cursor that fetches page i (cursors[0] = null). Previous page = one step back in this stack. */
  cursors: (PageCursor | null)[];
}

export interface PagedListState<T> {
  status: AsyncStatus;
  items: T[];
  error: unknown;
  pageIndex: number;
  hasNext: boolean;
  hasPrevious: boolean;
  next: () => void;
  previous: () => void;
  reload: () => void;
}

/**
 * Server-side cursor pagination over any `(cursor) => Promise<Page<T>>` (architecture §5.4): forward with the cursor the
 * previous page returned, backward through a stack of the cursors already used (no `endBefore`, no offsets). A different
 * `key` starts again from page 1. Stale responses are discarded by useAsyncData's token.
 */
export function usePagedList<T>(fetchPage: (cursor: PageCursor | null) => Promise<Page<T>>, key: string): PagedListState<T> {
  const [pager, setPager] = useState<PagerState>({ key, pageIndex: 0, cursors: [null] });

  // A different key starts again from page 1 (state derived during render, not in an effect).
  const current = pager.key === key ? pager : { key, pageIndex: 0, cursors: [null] };
  if (pager.key !== key) setPager(current);

  const { status, data, error, reload } = useAsyncData<Page<T>>(
    () => fetchPage(current.cursors[current.pageIndex] ?? null),
    `${key}|${current.pageIndex}`,
  );

  const nextCursor = data?.next ?? null;
  const next = useCallback(() => {
    if (!nextCursor) return;
    setPager((p) => ({ ...p, pageIndex: p.pageIndex + 1, cursors: [...p.cursors.slice(0, p.pageIndex + 1), nextCursor] }));
  }, [nextCursor]);
  const previous = useCallback(() => {
    setPager((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: p.pageIndex - 1 }));
  }, []);

  return {
    status,
    items: data?.items ?? [],
    error,
    pageIndex: current.pageIndex,
    hasNext: status === 'success' && nextCursor !== null,
    hasPrevious: current.pageIndex > 0,
    next,
    previous,
    reload,
  };
}
