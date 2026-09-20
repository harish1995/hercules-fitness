import { type MemberListQuery } from '../types/member';
import {
  COUNT_PLANS,
  endDateRangePlan,
  intersectDayRanges,
  isDateBucket,
  NOT_DELETED,
  PLAN_FIELD,
  statusDayRange,
  type DayRange,
  type QueryPlan,
} from './queryPredicates';
import { prefixRange } from './search';

export type { QueryPlan };

/**
 * A backend-neutral description of each members-list query (architecture §5.3). The service turns a plan into
 * Firestore constraints; `tests/unit/indexes.test.ts` checks every plan against `firestore.indexes.json`, so a
 * query cannot ship without its composite index (US-8.3b).
 */
export const PAGE_SIZE = 25;

/** The end-date range a browse query implies (status bucket intersected with the expiry range), or 'none' / 'empty'. */
export function browseDayRange(query: Extract<MemberListQuery, { mode: 'browse' }>): DayRange | 'none' | 'empty' {
  const bucket = isDateBucket(query.status) ? query.status : null;
  // Expiry-range inputs only apply where a date predicate is supported (matrix rows 3-4); SUSPENDED / NO_MEMBERSHIP have none.
  const userRange: DayRange = { from: query.expiryFrom, to: query.expiryTo };
  const hasUserRange = query.expiryFrom !== null || query.expiryTo !== null;
  if (query.status === 'SUSPENDED' || query.status === 'NO_MEMBERSHIP') return 'none';
  if (bucket === null && !hasUserRange) return 'none';
  // intersecting with "unbounded" also catches a user range whose from-date is after its to-date
  const merged = intersectDayRanges(bucket ? statusDayRange(bucket, query.today) : { from: null, to: null }, userRange);
  return merged === null ? 'empty' : merged;
}

/**
 * One plan per source. Name search has TWO sources (searchFullName, then searchReverseName); every other mode has one.
 * Only the combinations in the supported matrix exist here (§5.3): there is deliberately NO plan for "search + status
 * filter" (row 8) or for "expiry sort without a date filter" (row 9), so they cannot be issued by accident. An empty
 * intersection of the status range and the expiry range yields NO plans (the list shows an empty state, no query runs).
 */
export function planMemberQuery(query: MemberListQuery): QueryPlan[] {
  if (query.mode === 'browse') {
    const range = browseDayRange(query);
    if (range === 'empty') return [];
    if (range !== 'none') {
      // rows 3-4: a date filter FORCES the expiry sort (rule 9); default ascending
      return [endDateRangePlan(range, { planId: query.planId, order: query.sort === 'EXPIRY_DESC' ? 'desc' : 'asc' })];
    }
    // rows 1, 2, 5, 6: newest registered first
    const equals: QueryPlan['equals'] = [NOT_DELETED];
    if (query.status === 'SUSPENDED') equals.push({ field: 'suspended', value: true });
    if (query.status === 'NO_MEMBERSHIP') equals.push({ field: 'hasMembership', value: false });
    else if (query.planId) equals.push({ field: PLAN_FIELD, value: query.planId });
    return [{ equals, orderBy: [{ field: 'createdAt', direction: 'desc' }] }];
  }
  const { lo, hi } = prefixRange(query.term);
  const searchPlan = (field: string): QueryPlan => ({
    equals: [NOT_DELETED],
    range: { field, lo, hi },
    orderBy: [{ field, direction: 'asc' }],
  });
  switch (query.kind) {
    case 'mobile':
      return [searchPlan('searchMobile')];
    case 'memberId':
      return [searchPlan('memberId')];
    case 'name':
      return [searchPlan('searchFullName'), searchPlan('searchReverseName')];
  }
}

/** Queries the dashboard issues (counts + the 10-row table + the plan chart), so the index test covers them too. */
export function dashboardQueryPlans(today: Date): QueryPlan[] {
  const bucket = (s: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED') => endDateRangePlan(statusDayRange(s, today), { order: null });
  return [
    COUNT_PLANS.total,
    // new members per month: deleted == false AND joiningDate in [start, end)
    { equals: [NOT_DELETED], range: { field: 'joiningDate', lo: null, hi: null }, orderBy: [{ field: 'joiningDate', direction: 'asc' }] },
    bucket('ACTIVE'),
    bucket('EXPIRING_SOON'),
    bucket('EXPIRED'),
    COUNT_PLANS.suspended,
    COUNT_PLANS.noMembership,
    // plan distribution: members on a plan that are not expired (ACTIVE + EXPIRING_SOON): endDate >= today
    endDateRangePlan({ from: today, to: null }, { planId: 'plan', order: null }),
    // next-10 table: today <= end <= today+7, soonest first, limit 10
    endDateRangePlan(statusDayRange('EXPIRING_SOON', today), { order: 'asc' }),
  ];
}
