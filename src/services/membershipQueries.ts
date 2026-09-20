import { type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { membershipHistoryPlan } from '../domain/queryPredicates';
import { type Page, type PageCursor } from '../types/member';
import { type Membership } from '../types/membership';
import { mapReadError } from './errors';
import { membershipFromDoc } from './firestoreConverters';
import { fetchPlanDocs } from './queryBuilder';

/** Membership history of one member: newest first, cursor-paginated (US-3.13b). Index: memberDocId + createdAt desc. */
export const HISTORY_PAGE_SIZE = 25;

export async function listMembershipsPageFor(
  db: Firestore,
  memberDocId: string,
  cursor: PageCursor | null = null,
  pageSize: number = HISTORY_PAGE_SIZE,
): Promise<Page<Membership>> {
  try {
    const after = (cursor as unknown as QueryDocumentSnapshot | null) ?? null;
    const docs = await fetchPlanDocs(db, membershipHistoryPlan(memberDocId), after, pageSize + 1);
    const rows = docs.slice(0, pageSize);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((d) => membershipFromDoc(d.id, d.data())),
      next: docs.length > pageSize && last !== undefined ? (last as unknown as PageCursor) : null,
    };
  } catch (e) {
    throw mapReadError(e);
  }
}
