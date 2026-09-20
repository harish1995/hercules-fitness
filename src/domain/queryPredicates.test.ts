import { describe, expect, it } from 'vitest';
import { addIstDays, fromCivilDate } from './dates';
import {
  COUNT_PLANS,
  endDateRangePlan,
  expiringWindowRange,
  intersectDayRanges,
  isDateBucket,
  membershipHistoryPlan,
  statusDayRange,
  type DateBucket,
  type DayRange,
} from './queryPredicates';
import { calculateMembershipStatus } from './status';

/**
 * US-8.1a / US-3.4g: the QUERY side of status (date ranges used by the dashboard cards, the list filter, the Expiring / Expired pages
 * and the reports) must agree with the per-member status function for every possible end date, so a card always equals its list.
 */
const TODAY = fromCivilDate(2026, 9, 19);
const clock = () => new Date(TODAY.getTime() + 6 * 3_600_000);
const inRange = (r: DayRange, d: Date) => (r.from === null || d >= r.from) && (r.to === null || d <= r.to);

describe('statusDayRange agrees with calculateMembershipStatus for every end date (partition rule, FR-4)', () => {
  const buckets: DateBucket[] = ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'];

  it('every end date from -60 to +60 days falls in exactly ONE bucket, and it is the one the status function reports', () => {
    for (let offset = -60; offset <= 60; offset++) {
      const end = addIstDays(TODAY, offset);
      const hits = buckets.filter((b) => inRange(statusDayRange(b, TODAY), end));
      expect(hits, `offset ${offset}`).toHaveLength(1);
      expect(hits[0]).toBe(calculateMembershipStatus(null, end, { clock }).status);
    }
  });

  it('the boundary days: EXPIRED ends yesterday, EXPIRING_SOON is today..today+7, ACTIVE starts today+8', () => {
    expect(statusDayRange('EXPIRED', TODAY)).toEqual({ from: null, to: addIstDays(TODAY, -1) });
    expect(statusDayRange('EXPIRING_SOON', TODAY)).toEqual({ from: TODAY, to: addIstDays(TODAY, 7) });
    expect(statusDayRange('ACTIVE', TODAY)).toEqual({ from: addIstDays(TODAY, 8), to: null });
  });

  it('isDateBucket narrows the filter values', () => {
    expect(['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'].every(isDateBucket)).toBe(true);
    expect(['SUSPENDED', 'NO_MEMBERSHIP', 'ALL', ''].some(isDateBucket)).toBe(false);
  });
});

describe('expiringWindowRange (US-3.9b): window N = 0 <= daysRemaining <= N', () => {
  it.each([1, 3, 7, 15])('window %d includes today and today+%d, excludes yesterday and the day after', (n) => {
    const r = expiringWindowRange(n, TODAY);
    expect(inRange(r, TODAY)).toBe(true);
    expect(inRange(r, addIstDays(TODAY, n))).toBe(true);
    expect(inRange(r, addIstDays(TODAY, -1))).toBe(false);
    expect(inRange(r, addIstDays(TODAY, n + 1))).toBe(false);
  });

  it('windows of 8-15 days list members whose badge is still ACTIVE (documented in FR-8)', () => {
    const end = addIstDays(TODAY, 10);
    expect(inRange(expiringWindowRange(15, TODAY), end)).toBe(true);
    expect(calculateMembershipStatus(null, end, { clock }).status).toBe('ACTIVE');
  });
});

describe('intersectDayRanges (status filter AND expiry range are one query)', () => {
  const day = (n: number) => addIstDays(TODAY, n);

  it('intersects bounded ranges, treats null as unbounded, and reports an empty intersection as null', () => {
    expect(intersectDayRanges({ from: day(0), to: day(7) }, { from: day(3), to: day(20) })).toEqual({ from: day(3), to: day(7) });
    expect(intersectDayRanges({ from: null, to: day(-1) }, { from: day(-30), to: null })).toEqual({ from: day(-30), to: day(-1) });
    expect(intersectDayRanges({ from: null, to: null }, { from: null, to: null })).toEqual({ from: null, to: null });
    expect(intersectDayRanges({ from: day(0), to: day(7) }, { from: day(8), to: day(9) })).toBeNull();
    expect(intersectDayRanges({ from: day(8), to: null }, { from: null, to: day(7) })).toBeNull();
  });

  it('a single shared day is a non-empty intersection (both ends inclusive)', () => {
    expect(intersectDayRanges({ from: day(0), to: day(7) }, { from: day(7), to: day(9) })).toEqual({ from: day(7), to: day(7) });
  });

  it('Expired + a range starting today is empty (the UI shows an empty state without querying)', () => {
    expect(intersectDayRanges(statusDayRange('EXPIRED', TODAY), { from: TODAY, to: null })).toBeNull();
  });
});

describe('query plans carry the predicates every count and list shares', () => {
  it('a status plan is deleted == false AND suspended == false with a range on the latest end date (+ optional plan)', () => {
    const plan = endDateRangePlan(statusDayRange('EXPIRING_SOON', TODAY), { order: 'asc' });
    expect(plan.equals).toEqual([
      { field: 'deleted', value: false },
      { field: 'suspended', value: false },
    ]);
    expect(plan.range).toEqual({ field: 'membership.endDate', lo: TODAY, hi: addIstDays(TODAY, 7) });
    expect(plan.orderBy).toEqual([{ field: 'membership.endDate', direction: 'asc' }]);
    const withPlan = endDateRangePlan(statusDayRange('ACTIVE', TODAY), { planId: 'p1', order: null });
    expect(withPlan.equals).toContainEqual({ field: 'membership.planId', value: 'p1' });
    expect(withPlan.orderBy).toEqual([]);
  });

  it('the flag-based counts: total (live), suspended, no membership', () => {
    expect(COUNT_PLANS.total.equals).toEqual([{ field: 'deleted', value: false }]);
    expect(COUNT_PLANS.suspended.equals).toContainEqual({ field: 'suspended', value: true });
    expect(COUNT_PLANS.noMembership.equals).toContainEqual({ field: 'hasMembership', value: false });
  });

  it('membership history is newest first for one member', () => {
    expect(membershipHistoryPlan('m1')).toEqual({
      collection: 'memberships',
      equals: [{ field: 'memberDocId', value: 'm1' }],
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
    });
  });
});
