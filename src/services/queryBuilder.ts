import {
  collection,
  count,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  Timestamp,
  where,
  type Firestore,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { type QueryPlan } from '../domain/queryPredicates';

/**
 * Turns a backend-neutral `QueryPlan` (domain/queryPredicates.ts) into Firestore constraints. Every query the app issues
 * over members / memberships is built HERE from a plan, and `tests/unit/indexes.test.ts` checks the same plans against
 * `firestore.indexes.json`, so the query and its index cannot drift apart (US-8.3b).
 */

/** Dates go to Firestore as Timestamps (calendar days are 00:00 IST instants); everything else is passed through. */
const value = (v: unknown): unknown => (v instanceof Date ? Timestamp.fromDate(v) : v);

export function planConstraints(plan: QueryPlan, after: QueryDocumentSnapshot | null, count: number | null): QueryConstraint[] {
  const constraints: QueryConstraint[] = plan.equals.map((e) => where(e.field, '==', value(e.value)));
  if (plan.range) {
    if (plan.range.lo !== null) constraints.push(where(plan.range.field, '>=', value(plan.range.lo)));
    if (plan.range.hi !== null) constraints.push(where(plan.range.field, '<=', value(plan.range.hi)));
  }
  for (const r of plan.extraRanges ?? []) {
    if (r.lo !== null) constraints.push(where(r.field, '>=', value(r.lo)));
    if (r.hi !== null) constraints.push(where(r.field, '<=', value(r.hi)));
  }
  for (const o of plan.orderBy) constraints.push(orderBy(o.field, o.direction));
  if (after) constraints.push(startAfter(after));
  if (count !== null) constraints.push(limit(count));
  return constraints;
}

export function planQuery(db: Firestore, plan: QueryPlan, after: QueryDocumentSnapshot | null, count: number | null): Query {
  return query(collection(db, plan.collection ?? COLLECTIONS.members), ...planConstraints(plan, after, count));
}

export async function fetchPlanDocs(
  db: Firestore,
  plan: QueryPlan,
  after: QueryDocumentSnapshot | null,
  count: number,
): Promise<QueryDocumentSnapshot[]> {
  return (await getDocs(planQuery(db, plan, after, count))).docs;
}

/** An aggregation (`count()`): billed by index entries scanned, never a collection read (FR-9, NFR-9). */
export async function countPlan(db: Firestore, plan: QueryPlan): Promise<number> {
  const snap = await getCountFromServer(planQuery(db, plan, null, null));
  return snap.data().count;
}

/**
 * `sum(sumField)` and `count()` over one plan in ONE aggregation (billed by index entries scanned, never a collection
 * read, FR-9). The sum is exact: the field holds integer paise, and Firestore adds integers as integers.
 */
export async function sumAndCountPlan(db: Firestore, plan: QueryPlan): Promise<{ total: number; count: number }> {
  if (!plan.sumField) throw new Error('sumAndCountPlan needs a plan with a sumField');
  const snap = await getAggregateFromServer(planQuery(db, plan, null, null), { total: sum(plan.sumField), count: count() });
  const { total, count: n } = snap.data();
  return { total, count: n };
}
