import {
  doc,
  getDoc,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { istMonthRange, lastIstMonths, systemClock, todayIstStart, type Clock } from '../domain/dates';
import { PAGE_SIZE, planMemberQuery } from '../domain/memberQueryPlan';
import {
  COUNT_PLANS,
  endDateRangePlan,
  expiringWindowRange,
  NOT_DELETED,
  statusDayRange,
  type QueryPlan,
} from '../domain/queryPredicates';
import { fullNameHasPrefix } from '../domain/search';
import {
  type DashboardStats,
  type Member,
  type MemberListQuery,
  type Page,
  type PageCursor,
  type PlanDistributionEntry,
  type StatusCounts,
} from '../types/member';
import { mapReadError } from './errors';
import { memberFromDoc } from './firestoreConverters';
import { listPlansFor } from './planQueries';
import { countPlan, fetchPlanDocs } from './queryBuilder';

/**
 * Read paths for members. Every list query is server-side, indexed, cursor-paginated (`startAfter`, never
 * `offset`) and reads at most `pageSize + 1` documents, so the reads do not grow with the collection (US-2.8a).
 * The query SHAPES come from `domain/memberQueryPlan.ts` / `domain/queryPredicates.ts`, which a unit test checks
 * against firestore.indexes.json.
 */

interface CursorState {
  /** which plan (source) the next page continues in */
  source: number;
  after: QueryDocumentSnapshot | null;
}

const asCursor = (state: CursorState): PageCursor => state as unknown as PageCursor;
const fromCursor = (cursor: PageCursor | null): CursorState => (cursor as unknown as CursorState | null) ?? { source: 0, after: null };

const toMember = (d: QueryDocumentSnapshot): Member => memberFromDoc(d.id, d.data());

/**
 * One page of members.
 *
 * Browse, mobile and Member-ID modes are a single indexed query. Name search is TWO prefix queries
 * (searchFullName, then searchReverseName) combined as: first every full-name match in name order, then the
 * reverse-name matches that were not already listed. That yields the exact union with no duplicates and no
 * omissions across pages, with a cursor that is just (source, last document). The `+1` document read tells the
 * UI whether a next page exists without a count query.
 */
export async function listMembersPage(
  db: Firestore,
  listQuery: MemberListQuery,
  cursor: PageCursor | null = null,
  pageSize: number = PAGE_SIZE,
): Promise<Page<Member>> {
  const plans = planMemberQuery(listQuery);
  const start = fromCursor(cursor);
  const wanted = pageSize + 1;
  const candidates: { source: number; snap: QueryDocumentSnapshot }[] = [];
  let source = start.source;
  let after = start.after;

  try {
    while (source < plans.length && candidates.length < wanted) {
      const plan = plans[source];
      if (!plan) break;
      const need = wanted - candidates.length;
      const docs = await fetchPlanDocs(db, plan, after, need);
      for (const snap of docs) {
        after = snap;
        // Reverse-name pass: skip anyone already listed by the full-name pass.
        if (source > 0 && listQuery.mode === 'search' && fullNameHasPrefix(String(snap.data().searchFullName ?? ''), listQuery.term)) {
          continue;
        }
        candidates.push({ source, snap });
      }
      if (docs.length < need) {
        source += 1; // this source is exhausted
        after = null;
      }
    }
  } catch (e) {
    throw mapReadError(e);
  }

  const pageRows = candidates.slice(0, pageSize);
  const last = pageRows[pageRows.length - 1];
  const hasNext = candidates.length > pageSize && last !== undefined;
  return {
    items: pageRows.map((c) => toMember(c.snap)),
    next: hasNext ? asCursor({ source: last.source, after: last.snap }) : null,
  };
}

/** A member by document id; null when it does not exist OR is soft-deleted ("Member not found", US-2.9c). */
export async function getMemberById(db: Firestore, memberDocId: string): Promise<Member | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.members, memberDocId));
    const data = snap.data();
    if (!snap.exists() || !data || data.deleted === true) return null;
    return memberFromDoc(snap.id, data);
  } catch (e) {
    throw mapReadError(e);
  }
}

/** Non-deleted members: one aggregation, billed as an index scan rather than a collection read (US-2.12a). */
export async function countMembers(db: Firestore): Promise<number> {
  return countPlan(db, COUNT_PLANS.total);
}

/** New members per IST month by JOINING date over the last 12 months (US-2.12c): 12 aggregations, in parallel. */
export async function newMembersByMonth(
  db: Firestore,
  clock: Clock = systemClock,
): Promise<DashboardStats['newMembersByMonth']> {
  const months = lastIstMonths(12, clock);
  return Promise.all(
    months.map(async (m) => {
      const { start, endExclusive } = istMonthRange(m.year, m.month);
      // [start, endExclusive) expressed as the inclusive range [start, endExclusive - 1 ms] (Dates have ms precision)
      const plan: QueryPlan = {
        equals: [NOT_DELETED],
        range: { field: 'joiningDate', lo: start, hi: new Date(endExclusive.getTime() - 1) },
        orderBy: [],
      };
      return { ...m, count: await countPlan(db, plan) };
    }),
  );
}

/**
 * The status cards (US-3.12a): every count is one aggregation built from the SAME predicates as the list filters, so a
 * card always equals its filtered list. Total = Active + Expiring + Expired + Suspended + No membership (FR-4 partition).
 */
export async function getStatusCounts(db: Firestore, today: Date): Promise<StatusCounts> {
  const bucket = (s: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED') => endDateRangePlan(statusDayRange(s, today), { order: null });
  const [total, active, expiringSoon, expired, suspended, noMembership] = await Promise.all([
    countPlan(db, COUNT_PLANS.total),
    countPlan(db, bucket('ACTIVE')),
    countPlan(db, bucket('EXPIRING_SOON')),
    countPlan(db, bucket('EXPIRED')),
    countPlan(db, COUNT_PLANS.suspended),
    countPlan(db, COUNT_PLANS.noMembership),
  ]);
  return { total, active, expiringSoon, expired, suspended, noMembership };
}

/** Upper bound on plans charted (one aggregation each). A gym has a handful; this only stops a runaway. */
const MAX_CHARTED_PLANS = 30;

/** Members whose current membership is ACTIVE or EXPIRING_SOON (end >= today, not suspended) per plan (NEW-19). */
export async function getPlanDistribution(db: Firestore, today: Date): Promise<PlanDistributionEntry[]> {
  const plans = (await listPlansFor(db)).slice(0, MAX_CHARTED_PLANS);
  const counted = await Promise.all(
    plans.map(async (p) => ({
      planId: p.id,
      planName: p.name,
      count: await countPlan(db, endDateRangePlan({ from: today, to: null }, { planId: p.id, order: null })),
    })),
  );
  return counted.filter((e) => e.count > 0).sort((a, b) => b.count - a.count || a.planName.localeCompare(b.planName));
}

/** The 10 non-suspended members with the nearest end date within 0-7 days: a limited query, 10 document reads (US-3.12b). */
export async function getNextExpiring(db: Firestore, today: Date, count = 10): Promise<Member[]> {
  const plan = endDateRangePlan(statusDayRange('EXPIRING_SOON', today), { order: 'asc' });
  return (await fetchPlanDocs(db, plan, null, count)).map(toMember);
}

export async function getDashboardStatsFor(db: Firestore, clock: Clock = systemClock): Promise<DashboardStats> {
  const today = todayIstStart(clock);
  try {
    const [byMonth, statusCounts, planDistribution, nextExpiring] = await Promise.all([
      newMembersByMonth(db, clock),
      getStatusCounts(db, today),
      getPlanDistribution(db, today),
      getNextExpiring(db, today),
    ]);
    return { totalMembers: statusCounts.total, newMembersByMonth: byMonth, statusCounts, planDistribution, nextExpiring };
  } catch (e) {
    throw mapReadError(e);
  }
}

// ---- Expiring Soon / Expired pages (US-3.9, US-3.10) ----------------------------------------------------------------

/** Generic cursor page over ONE query plan (the expiry pages have a single source). */
export async function listPlanPage(
  db: Firestore,
  plan: QueryPlan,
  cursor: PageCursor | null,
  pageSize: number = PAGE_SIZE,
): Promise<Page<Member>> {
  try {
    const after = (cursor as unknown as QueryDocumentSnapshot | null) ?? null;
    const docs = await fetchPlanDocs(db, plan, after, pageSize + 1);
    const rows = docs.slice(0, pageSize);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toMember),
      next: docs.length > pageSize && last !== undefined ? (last as unknown as PageCursor) : null,
    };
  } catch (e) {
    throw mapReadError(e);
  }
}

/** Members expiring in the next `days` days (0 <= daysRemaining <= days), not suspended, soonest first. */
export function listExpiringPage(db: Firestore, days: number, cursor: PageCursor | null, today: Date): Promise<Page<Member>> {
  return listPlanPage(db, endDateRangePlan(expiringWindowRange(days, today), { order: 'asc' }), cursor);
}

/** Members whose latest end date is before today, not suspended, most recently expired first. */
export function listExpiredPage(db: Firestore, cursor: PageCursor | null, today: Date): Promise<Page<Member>> {
  return listPlanPage(db, endDateRangePlan(statusDayRange('EXPIRED', today), { order: 'desc' }), cursor);
}
