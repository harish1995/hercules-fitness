import { type PaymentListFilter } from '../types/payment';
import { NOT_DELETED, type EqValue, type QueryPlan } from './queryPredicates';

/**
 * Every payments / pending-payments query the app issues, as backend-neutral plans (architecture §5.6, §5.7). The services
 * turn a plan into Firestore constraints (services/queryBuilder.ts) and `tests/unit/indexes.test.ts` checks the SAME plans
 * against `firestore.indexes.json`, so a query cannot ship without its composite index (US-8.3b).
 */

export const PAYMENTS = 'payments';
export const PAYMENT_PAGE_SIZE = 25;

/** Payments list: active (voided == false) or voided-only, an optional method, an inclusive IST day range; newest first. */
export function paymentsListPlan(filter: PaymentListFilter): QueryPlan {
  const equals: { field: string; value: EqValue }[] = [{ field: 'voided', value: filter.voided }];
  if (filter.method !== null) equals.push({ field: 'method', value: filter.method });
  return {
    collection: PAYMENTS,
    equals,
    // inclusive day bounds: paymentDate is stored at 00:00 IST, so `<= to` includes the whole `to` day
    ...(filter.from !== null || filter.to !== null ? { range: { field: 'paymentDate', lo: filter.from, hi: filter.to } } : {}),
    orderBy: [{ field: 'paymentDate', direction: 'desc' }],
  };
}

/** One member's payment history INCLUDING voided rows (they stay visible, marked VOID, US-4.7b); newest first. */
export function memberPaymentsPlan(memberDocId: string): QueryPlan {
  return {
    collection: PAYMENTS,
    equals: [{ field: 'memberDocId', value: memberDocId }],
    orderBy: [{ field: 'paymentDate', direction: 'desc' }],
  };
}

/** A member's memberships that still owe money, oldest first: the record-payment dialog's choices (default = the first). */
export function unpaidMembershipsPlan(memberDocId: string): QueryPlan {
  return {
    collection: 'memberships',
    equals: [{ field: 'memberDocId', value: memberDocId }, { field: 'unpaid', value: true }],
    orderBy: [{ field: 'startDate', direction: 'asc' }],
  };
}

/**
 * Revenue of one IST month (cash basis, US-4.6): the SUM of non-voided payments dated in [start, end]. Voided payments are
 * excluded by `voided == false`; a deleted member's payments are still included (US-4.6d: no `deleted` predicate exists).
 */
export function revenueRangePlan(start: Date, endInclusive: Date): QueryPlan {
  return {
    collection: PAYMENTS,
    equals: [{ field: 'voided', value: false }],
    range: { field: 'paymentDate', lo: start, hi: endInclusive },
    orderBy: [{ field: 'paymentDate', direction: 'asc' }],
    sumField: 'amountPaise',
  };
}

/**
 * Members who owe money (`pendingPaise > 0`, not deleted, US-4.5d), LARGEST first. Doubles as the aggregation behind the
 * Pending Payments card (count + sum over the same index scan). Index (members): deleted + pendingPaise desc.
 */
export function pendingMembersPlan(opts: { aggregate: boolean }): QueryPlan {
  return {
    equals: [NOT_DELETED],
    // `> 0` on integer paise is `>= 1`
    range: { field: 'pendingPaise', lo: 1, hi: null },
    orderBy: [{ field: 'pendingPaise', direction: 'desc' }],
    ...(opts.aggregate ? { sumField: 'pendingPaise' } : {}),
  };
}
