import { useCallback, useMemo, useState } from 'react';
import { listMemberships } from '../services/membershipService';
import { type Page, type PageCursor } from '../types/member';
import { type Membership } from '../types/membership';
import { useAsyncData, type AsyncStatus } from './useAsyncData';

export interface MembershipHistoryState {
  status: AsyncStatus;
  items: Membership[];
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: unknown;
  loadMore: () => void;
  reload: () => void;
}

interface MoreState {
  key: string;
  items: Membership[];
  /** cursor for the page after the last loaded one; undefined = not started, null = no more */
  cursor: PageCursor | null | undefined;
  loading: boolean;
  error: unknown;
}

/**
 * A member's membership history, newest first (US-3.13b): the first page loads with the profile, "Show more" appends the
 * following pages with the service's cursor. `refreshKey` changes after an assign / renew so the list reloads.
 */
export function useMembershipHistory(memberDocId: string, refreshKey: number): MembershipHistoryState {
  const key = `${memberDocId}#${refreshKey}`;
  const first = useAsyncData<Page<Membership>>(() => listMemberships(memberDocId, null), `history:${key}`);
  const [more, setMore] = useState<MoreState>({ key, items: [], cursor: undefined, loading: false, error: undefined });
  // appended pages belong to one (member, refresh) pair: a different key starts again
  const current = useMemo<MoreState>(
    () => (more.key === key ? more : { key, items: [], cursor: undefined, loading: false, error: undefined }),
    [more, key],
  );

  const cursor = current.cursor === undefined ? (first.data?.next ?? null) : current.cursor;
  const loadMore = useCallback(() => {
    if (cursor === null || current.loading) return;
    setMore({ ...current, loading: true, error: undefined });
    listMemberships(memberDocId, cursor).then(
      (page) => setMore((m) => ({ key, items: [...(m.key === key ? m.items : []), ...page.items], cursor: page.next, loading: false, error: undefined })),
      (error: unknown) => setMore((m) => ({ ...(m.key === key ? m : current), loading: false, error })),
    );
  }, [cursor, current, memberDocId, key]);

  return {
    status: first.status,
    items: [...(first.data?.items ?? []), ...current.items],
    error: first.error,
    hasMore: first.status === 'success' && cursor !== null,
    loadingMore: current.loading,
    moreError: current.error,
    loadMore,
    reload: first.reload,
  };
}
