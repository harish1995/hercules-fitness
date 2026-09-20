import { addIstDays } from './dates';
import { EXPIRING_SOON_MAX_DAYS } from './status';

/**
 * Status as a DATE RANGE (architecture §5.1, FR-4). The dashboard cards, the members-list filter, the Expiring / Expired
 * pages and the plan chart ALL build their queries from the functions here, so the counts cannot disagree with the lists
 * (US-3.4g, US-3.8a, US-3.12a). Because `membership.endDate` is stored at 00:00 IST, inclusive day bounds are exact.
 *
 * This module also owns the backend-neutral `QueryPlan` shape; `tests/unit/indexes.test.ts` checks every plan against
 * `firestore.indexes.json`, so a query cannot ship without its composite index (US-8.3b).
 */

/** A Date (an IST day start, e.g. an attendance `date`) is converted to a Timestamp by the query builder. */
export type EqValue = boolean | string | Date;

export interface QueryPlan {
  /** default `members` */
  collection?: string;
  equals: { field: string; value: EqValue }[];
  /**
   * INCLUSIVE range on one field (either bound optional): a prefix range for search, a day range for expiry. Firestore
   * needs it to be the first orderBy (and, when there is no orderBy, the last field of the index).
   */
  range?: { field: string; lo: unknown; hi: unknown };
  /**
   * ADDITIONAL inclusive ranges on OTHER fields (Firestore's multiple-inequality queries). Only the pending-payments report
   * uses one (pendingPaise > 0 AND a joining-date range, architecture §5.7). Every field here must also be an explicit
   * `orderBy`, after the `range` field, so the composite index is unambiguous: equality fields, then the orderBy fields in order.
   */
  extraRanges?: { field: string; lo: unknown; hi: unknown }[];
  orderBy: { field: string; direction: 'asc' | 'desc' }[];
  /**
   * The field a `sum()` aggregation adds up. An aggregation is served by an index scan, so the index must END with this
   * field (Firestore reads the values from the index instead of fetching documents). Only used with `sumPlan`.
   */
  sumField?: string;
}

export const END_DATE_FIELD = 'membership.endDate';
export const PLAN_FIELD = 'membership.planId';

export const NOT_DELETED = { field: 'deleted', value: false } as const;
export const NOT_SUSPENDED = { field: 'suspended', value: false } as const;

/** Inclusive IST-day bounds (each at 00:00 IST). null = unbounded on that side. */
export interface DayRange {
  from: Date | null;
  to: Date | null;
}

/** The three date-bucket statuses. Suspended members are never in them (`suspended == false` in every plan). */
export type DateBucket = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';

export function isDateBucket(status: string): status is DateBucket {
  return status === 'ACTIVE' || status === 'EXPIRING_SOON' || status === 'EXPIRED';
}

/**
 * ACTIVE: end >= today+8. EXPIRING_SOON: today <= end <= today+7. EXPIRED: end <= today-1 (i.e. before today).
 * These are exactly the D-4 boundaries: the three ranges are disjoint and cover every end date.
 */
export function statusDayRange(status: DateBucket, today: Date): DayRange {
  switch (status) {
    case 'ACTIVE':
      return { from: addIstDays(today, EXPIRING_SOON_MAX_DAYS + 1), to: null };
    case 'EXPIRING_SOON':
      return { from: today, to: addIstDays(today, EXPIRING_SOON_MAX_DAYS) };
    case 'EXPIRED':
      return { from: null, to: addIstDays(today, -1) };
  }
}

/** The Expiring Soon page window: 0 <= daysRemaining <= N (so window 1 = today and tomorrow, US-3.9b). */
export function expiringWindowRange(days: number, today: Date): DayRange {
  return { from: today, to: addIstDays(today, days) };
}

/** Intersection of two ranges, or null when it is empty (the UI then shows an empty state without querying). */
export function intersectDayRanges(a: DayRange, b: DayRange): DayRange | null {
  const from = a.from === null ? b.from : b.from === null ? a.from : a.from.getTime() >= b.from.getTime() ? a.from : b.from;
  const to = a.to === null ? b.to : b.to === null ? a.to : a.to.getTime() <= b.to.getTime() ? a.to : b.to;
  if (from !== null && to !== null && from.getTime() > to.getTime()) return null;
  return { from, to };
}

/**
 * Members whose LATEST end date is in `range`, not suspended, not deleted, optionally on one plan. `order: null` = a
 * count / aggregation (no sort needed). Indexes: (deleted, suspended, [planId,] membership.endDate asc|desc).
 */
export function endDateRangePlan(range: DayRange, opts: { planId?: string | null; order: 'asc' | 'desc' | null }): QueryPlan {
  const equals: QueryPlan['equals'] = [NOT_DELETED, NOT_SUSPENDED];
  if (opts.planId) equals.push({ field: PLAN_FIELD, value: opts.planId });
  return {
    equals,
    range: { field: END_DATE_FIELD, lo: range.from, hi: range.to },
    orderBy: opts.order ? [{ field: END_DATE_FIELD, direction: opts.order }] : [],
  };
}

export const COUNT_PLANS = {
  total: { equals: [NOT_DELETED], orderBy: [] } satisfies QueryPlan,
  suspended: { equals: [NOT_DELETED, { field: 'suspended', value: true }], orderBy: [] } satisfies QueryPlan,
  noMembership: { equals: [NOT_DELETED, { field: 'hasMembership', value: false }], orderBy: [] } satisfies QueryPlan,
};

/** A member's membership history, newest first. Index (memberships): memberDocId + createdAt desc. */
export function membershipHistoryPlan(memberDocId: string): QueryPlan {
  return {
    collection: 'memberships',
    equals: [{ field: 'memberDocId', value: memberDocId }],
    orderBy: [{ field: 'createdAt', direction: 'desc' }],
  };
}
