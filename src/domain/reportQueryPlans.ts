import { PAYMENT_METHODS, type AttendanceStatus, type PaymentMethod } from '../constants/enums';
import { type ReportAttendanceStatus, type ReportSpec } from '../types/report';
import { ATTENDANCE } from './attendanceQueryPlans';
import { addIstDays, diffIstDays, formatIstDate, istMonthRange, toCivilDate } from './dates';
import { PAYMENTS, paymentsListPlan, pendingMembersPlan } from './paymentQueryPlans';
import {
  endDateRangePlan,
  intersectDayRanges,
  NOT_DELETED,
  statusDayRange,
  type DayRange,
  type QueryPlan,
} from './queryPredicates';

/**
 * The queries behind the six reports (architecture §5.7, US-6.1), as backend-neutral plans. The services turn a plan into
 * Firestore constraints (services/queryBuilder.ts) and `tests/unit/indexes.test.ts` checks the SAME plans against
 * `firestore.indexes.json`. The on-screen table, the totals and the CSV export all use the plans of ONE spec, so "the same
 * filters" (US-6.2a) is structural. Expired and Expiring reuse `endDateRangePlan` / `statusDayRange`, i.e. exactly the
 * predicates of the pages and the dashboard (US-6.1e).
 */

/** Rows per page on screen (the same as every other list). */
export const REPORT_PAGE_SIZE = 25;

/** A user filter that is impossible: both dates set and the end before the start (US-6.1b). */
export function reportRangeError(spec: Pick<ReportSpec, 'from' | 'to'>): 'RANGE_INVERTED' | null {
  return spec.from !== null && spec.to !== null && spec.from.getTime() > spec.to.getTime() ? 'RANGE_INVERTED' : null;
}

/**
 * The inclusive day range the report's date filter really applies to, or 'empty' when nothing can match (no query is issued):
 *   MEMBERS / PENDING  joining date          REVENUE  payment date          ATTENDANCE  attendance date
 *   EXPIRED            end date, and only before today  (intersected with the user range)
 *   EXPIRING           end date, and only today or later (intersected with the user range)
 * (US-6.1: the requirements' date meaning per report; PENDING uses the JOINING date, not the membership start date: see
 * architecture §5.7.)
 */
export function effectiveReportRange(spec: Pick<ReportSpec, 'report' | 'from' | 'to' | 'today'>): DayRange | 'empty' {
  if (reportRangeError(spec) !== null) return 'empty';
  const user: DayRange = { from: spec.from, to: spec.to };
  switch (spec.report) {
    case 'EXPIRED':
      return intersectDayRanges(statusDayRange('EXPIRED', spec.today), user) ?? 'empty';
    case 'EXPIRING':
      return intersectDayRanges({ from: spec.today, to: null }, user) ?? 'empty';
    default:
      return user;
  }
}

const dayRangeOf = (field: string, r: DayRange) => ({ field, lo: r.from, hi: r.to });

/** Members by JOINING date, oldest joiner first. Index (members): deleted + joiningDate. */
function membersPlan(r: DayRange): QueryPlan {
  return { equals: [NOT_DELETED], range: dayRangeOf('joiningDate', r), orderBy: [{ field: 'joiningDate', direction: 'asc' }] };
}

/**
 * Members who owe money, largest first, optionally only those who JOINED in a range (architecture §5.7). Without a joining
 * range it is exactly the Pending Payments page's plan (index deleted + pendingPaise desc). With one it is a two-inequality
 * query (`pendingPaise >= 1` and `joiningDate` in range) whose orderBy names both fields: index (members) deleted +
 * pendingPaise desc + joiningDate asc. `aggregate` adds the `sum(pendingPaise)` used for the totals.
 */
export function pendingReportPlan(r: DayRange, aggregate: boolean): QueryPlan {
  if (r.from === null && r.to === null) return pendingMembersPlan({ aggregate });
  return {
    equals: [NOT_DELETED],
    range: { field: 'pendingPaise', lo: 1, hi: null },
    extraRanges: [dayRangeOf('joiningDate', r)],
    orderBy: [
      { field: 'pendingPaise', direction: 'desc' },
      { field: 'joiningDate', direction: 'asc' },
    ],
    ...(aggregate ? { sumField: 'pendingPaise' } : {}),
  };
}

/**
 * Attendance records in a date range, oldest day first. With a status: index (attendance) status + date; without one only the
 * automatic single-field `date` index is needed. (Newest-first would need a second composite index for the status variants;
 * a report reads best in date order anyway.)
 */
export function attendanceReportPlan(status: ReportAttendanceStatus, r: DayRange): QueryPlan {
  return {
    collection: ATTENDANCE,
    equals: status === 'ALL' ? [] : [{ field: 'status', value: status }],
    range: dayRangeOf('date', r),
    orderBy: [{ field: 'date', direction: 'asc' }],
  };
}

/** Number of records of one status in a date range (a `count()`): the attendance report's totals. Index: status + date. */
export function attendanceCountPlan(status: AttendanceStatus, r: DayRange): QueryPlan {
  return { collection: ATTENDANCE, equals: [{ field: 'status', value: status }], range: dayRangeOf('date', r), orderBy: [] };
}

/** Non-voided payments in a payment-date range: the SUM of `amountPaise` (and the count). Index (payments): voided + paymentDate + amountPaise. */
export function revenueTotalPlan(r: DayRange): QueryPlan {
  return {
    collection: PAYMENTS,
    equals: [{ field: 'voided', value: false }],
    range: dayRangeOf('paymentDate', r),
    orderBy: [{ field: 'paymentDate', direction: 'asc' }],
    sumField: 'amountPaise',
  };
}

/** The same per payment method. Index (payments): voided + method + paymentDate + amountPaise. */
export function revenueMethodPlan(method: PaymentMethod, r: DayRange): QueryPlan {
  const total = revenueTotalPlan(r);
  return { ...total, equals: [...total.equals, { field: 'method', value: method }] };
}

/**
 * The query behind a report's table and CSV, or null when no query may run (a range that is inverted or cannot match:
 * the screen then shows an empty state, the export is disabled).
 */
export function planReport(spec: ReportSpec): QueryPlan | null {
  const range = effectiveReportRange(spec);
  if (range === 'empty') return null;
  switch (spec.report) {
    case 'MEMBERS':
      return membersPlan(range);
    case 'EXPIRED':
      return endDateRangePlan(range, { order: 'desc' }); // most recently expired first, like the Expired page
    case 'EXPIRING':
      return endDateRangePlan(range, { order: 'asc' }); // soonest first, like the Expiring page
    case 'REVENUE':
      return paymentsListPlan({ from: range.from, to: range.to, method: null, voided: false });
    case 'ATTENDANCE':
      return attendanceReportPlan(spec.status, range);
    case 'PENDING':
      return pendingReportPlan(range, false);
  }
}

// ---- revenue breakdown --------------------------------------------------------------------------------------------------

/** A per-day breakdown is offered up to this many days; longer ranges are grouped per IST month. */
export const REVENUE_MAX_DAILY_DAYS = 31;
/** ... and a per-month breakdown up to this many months (one `sum()` each); longer ranges show the totals only. */
export const REVENUE_MAX_MONTHS = 36;

// Fixed English abbreviations (ICU versions disagree on "Sep" vs "Sept"): the same labels as the dashboard chart.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface RevenueBucketRange {
  label: string;
  range: DayRange & { from: Date; to: Date };
}

/**
 * The buckets of a revenue breakdown for a bounded range: one per IST day (up to 31 days) or one per IST month clipped to the
 * range (up to 36 months); null when the range is too long. The buckets partition the range, so their totals add up to the
 * range total. Every bound is an IST day start and both ends are inclusive.
 */
export function revenueBuckets(from: Date, to: Date): { granularity: 'DAY' | 'MONTH'; buckets: RevenueBucketRange[] } | null {
  if (from.getTime() > to.getTime()) return null;
  const days = diffIstDays(from, to) + 1;
  if (days <= REVENUE_MAX_DAILY_DAYS) {
    const buckets: RevenueBucketRange[] = [];
    for (let i = 0; i < days; i++) {
      const day = addIstDays(from, i);
      buckets.push({ label: formatIstDate(day), range: { from: day, to: day } });
    }
    return { granularity: 'DAY', buckets };
  }
  const first = toCivilDate(from);
  const last = toCivilDate(to);
  const monthCount = (last.year - first.year) * 12 + (last.month - first.month) + 1;
  if (monthCount > REVENUE_MAX_MONTHS) return null;
  const buckets: RevenueBucketRange[] = [];
  for (let i = 0; i < monthCount; i++) {
    const index = first.year * 12 + (first.month - 1) + i;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const { start, endExclusive } = istMonthRange(year, month);
    const bucketFrom = start.getTime() < from.getTime() ? from : start;
    const monthLast = addIstDays(endExclusive, -1); // the month's last day (00:00 IST)
    const bucketTo = monthLast.getTime() > to.getTime() ? to : monthLast;
    buckets.push({ label: `${MONTH_ABBR[month - 1]} ${year}`, range: { from: bucketFrom, to: bucketTo } });
  }
  return { granularity: 'MONTH', buckets };
}

/** Every payment method, in display order (the by-method totals show all of them, including the ones with 0). */
export const REVENUE_METHODS = PAYMENT_METHODS;
