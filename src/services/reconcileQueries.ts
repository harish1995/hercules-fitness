import { collection, getDocs, limit, orderBy, query, startAfter, type Firestore, type QuerySnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { type ReconcileInput } from '../domain/reconcile';
import { memberFromDoc, membershipFromDoc, paymentFromDoc } from './firestoreConverters';

/**
 * READ-ONLY full scan for `scripts/reconcile.ts` (architecture 2.7, R-2). This is the ONE place that reads whole collections, so it
 * is a manually run diagnostic and no screen may call it: it bills one read per document (members + memberships + payments +
 * counters). Pages of `pageSize` ordered by document id, so no composite index is needed and a page never exceeds a request limit.
 * It performs no write of any kind. It needs an ADMIN (the rules refuse payments / deleted members to everyone else).
 */
export async function readReconcileInput(
  db: Firestore,
  opts: { pageSize?: number; onPage?: (collectionName: string, total: number) => void } = {},
): Promise<ReconcileInput> {
  const pageSize = opts.pageSize ?? 500;

  async function scan<T>(name: string, map: (d: QueryDocumentSnapshot) => T): Promise<T[]> {
    const out: T[] = [];
    let after: QueryDocumentSnapshot | null = null;
    for (;;) {
      const snap: QuerySnapshot = await getDocs(
        query(collection(db, name), orderBy('__name__'), ...(after ? [startAfter(after)] : []), limit(pageSize)),
      );
      for (const d of snap.docs) out.push(map(d));
      opts.onPage?.(name, out.length);
      if (snap.docs.length < pageSize) return out;
      after = snap.docs[snap.docs.length - 1] ?? null;
    }
  }

  const members = await scan(COLLECTIONS.members, (d) => memberFromDoc(d.id, d.data()));
  const memberships = await scan(COLLECTIONS.memberships, (d) => membershipFromDoc(d.id, d.data()));
  const payments = await scan(COLLECTIONS.payments, (d) => paymentFromDoc(d.id, d.data()));
  const counters = await scan(COLLECTIONS.counters, (d) => {
    const data = d.data();
    return { id: d.id, year: typeof data.year === 'number' ? data.year : 0, lastSeq: typeof data.lastSeq === 'number' ? data.lastSeq : 0 };
  });
  return { members, memberships, payments, counters };
}
