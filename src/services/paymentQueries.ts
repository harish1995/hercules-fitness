import { type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { istMonthRange, lastIstMonths, systemClock, type Clock } from '../domain/dates';
import {
  memberPaymentsPlan,
  PAYMENT_PAGE_SIZE,
  paymentsListPlan,
  pendingMembersPlan,
  revenueRangePlan,
  unpaidMembershipsPlan,
} from '../domain/paymentQueryPlans';
import { type QueryPlan } from '../domain/queryPredicates';
import { type Member, type Page, type PageCursor } from '../types/member';
import { type Membership } from '../types/membership';
import { type Payment, type PaymentDashboardStats, type PaymentListFilter } from '../types/payment';
import { mapReadError } from './errors';
import { membershipFromDoc, memberFromDoc, paymentFromDoc } from './firestoreConverters';
import { fetchPlanDocs, sumAndCountPlan } from './queryBuilder';

/**
 * Read paths for payments and the money figures (architecture §5.4, §5.6). Every list is server-side, indexed and
 * cursor-paginated (`startAfter`, never `offset`, at most `pageSize + 1` documents); every total is an AGGREGATION
 * (`sum` / `count`), so nothing here reads a whole collection. The query SHAPES come from `domain/paymentQueryPlans.ts`,
 * which a unit test checks against firestore.indexes.json.
 */

export { PAYMENT_PAGE_SIZE };

async function pageOf<T>(
  db: Firestore,
  plan: QueryPlan,
  cursor: PageCursor | null,
  pageSize: number,
  convert: (d: QueryDocumentSnapshot) => T,
): Promise<Page<T>> {
  try {
    const after = (cursor as unknown as QueryDocumentSnapshot | null) ?? null;
    const docs = await fetchPlanDocs(db, plan, after, pageSize + 1);
    const rows = docs.slice(0, pageSize);
    const last = rows[rows.length - 1];
    return { items: rows.map(convert), next: docs.length > pageSize && last !== undefined ? (last as unknown as PageCursor) : null };
  } catch (e) {
    throw mapReadError(e);
  }
}

const toPayment = (d: QueryDocumentSnapshot): Payment => paymentFromDoc(d.id, d.data());

/** The Payments page: filtered by an inclusive IST day range and a method; active or voided-only; newest first (US-4.4c). */
export function listPaymentsPageFor(
  db: Firestore,
  filter: PaymentListFilter,
  cursor: PageCursor | null = null,
  pageSize: number = PAYMENT_PAGE_SIZE,
): Promise<Page<Payment>> {
  return pageOf(db, paymentsListPlan(filter), cursor, pageSize, toPayment);
}

/** One member's payment history, voided rows included (marked by the UI), newest first (US-4.4a, US-4.7b). */
export function listMemberPaymentsPageFor(
  db: Firestore,
  memberDocId: string,
  cursor: PageCursor | null = null,
  pageSize: number = PAYMENT_PAGE_SIZE,
): Promise<Page<Payment>> {
  return pageOf(db, memberPaymentsPlan(memberDocId), cursor, pageSize, toPayment);
}

/** A gym member has a handful of memberships that owe money; this only stops a runaway list. */
const MAX_UNPAID_MEMBERSHIPS = 50;

/** The member's memberships with outstanding > 0, OLDEST first: the choices of the record-payment dialog (NEW-10). */
export async function listUnpaidMembershipsFor(db: Firestore, memberDocId: string): Promise<Membership[]> {
  try {
    const docs = await fetchPlanDocs(db, unpaidMembershipsPlan(memberDocId), null, MAX_UNPAID_MEMBERSHIPS);
    return docs.map((d) => membershipFromDoc(d.id, d.data()));
  } catch (e) {
    throw mapReadError(e);
  }
}

/** The Pending Payments list: members who owe money (not deleted), LARGEST amount first (US-4.5a). */
export function listPendingMembersPageFor(
  db: Firestore,
  cursor: PageCursor | null = null,
  pageSize: number = PAYMENT_PAGE_SIZE,
): Promise<Page<Member>> {
  return pageOf(db, pendingMembersPlan({ aggregate: false }), cursor, pageSize, (d) => memberFromDoc(d.id, d.data()));
}

/**
 * Pending total + number of members owing (US-4.5c): ONE aggregation, `sum(pendingPaise)` and `count()` over the members
 * with `pendingPaise > 0` that are not deleted (US-4.5d). Never loads the members.
 */
export async function getPendingTotals(db: Firestore): Promise<PaymentDashboardStats['pending']> {
  const { total, count } = await sumAndCountPlan(db, pendingMembersPlan({ aggregate: true }));
  return { totalPaise: total, memberCount: count };
}

/**
 * Revenue per IST month over the last 12 months, oldest first (US-4.6): 12 `sum(amountPaise)` aggregations in parallel over
 * the non-voided payments whose payment DATE is in the month. The month bounds are IST midnights, so a payment at 00:30 IST
 * on the 1st is in the new month and one at 23:30 IST on the last day is in the old one (US-4.6a).
 */
export async function getRevenueByMonth(db: Firestore, clock: Clock = systemClock): Promise<PaymentDashboardStats['revenueByMonth']> {
  const months = lastIstMonths(12, clock);
  return Promise.all(
    months.map(async (m) => {
      const { start, endExclusive } = istMonthRange(m.year, m.month);
      // [start, endExclusive) as the inclusive range [start, endExclusive - 1 ms]
      const { total } = await sumAndCountPlan(db, revenueRangePlan(start, new Date(endExclusive.getTime() - 1)));
      return { ...m, totalPaise: total };
    }),
  );
}

export async function getPaymentDashboardStatsFor(db: Firestore, clock: Clock = systemClock): Promise<PaymentDashboardStats> {
  try {
    const [pending, revenueByMonth] = await Promise.all([getPendingTotals(db), getRevenueByMonth(db, clock)]);
    const current = revenueByMonth[revenueByMonth.length - 1];
    return { pending, revenueByMonth, currentMonthPaise: current?.totalPaise ?? 0 };
  } catch (e) {
    throw mapReadError(e);
  }
}
