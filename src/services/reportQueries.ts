import { type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { type DayRange } from '../domain/queryPredicates';
import {
  attendanceCountPlan,
  effectiveReportRange,
  pendingReportPlan,
  planReport,
  revenueBuckets,
  revenueMethodPlan,
  revenueTotalPlan,
  REVENUE_METHODS,
  REPORT_PAGE_SIZE,
} from '../domain/reportQueryPlans';
import { type Page, type PageCursor } from '../types/member';
import { type ReportRecord, type ReportSpec, type ReportTotals, type RevenueSummary } from '../types/report';
import { mapReadError } from './errors';
import { attendanceFromDoc, memberFromDoc, paymentFromDoc } from './firestoreConverters';
import { countPlan, fetchPlanDocs, sumAndCountPlan } from './queryBuilder';

/**
 * Read paths for the six reports (architecture §5.7, US-6.1). The tables and the export both read through `listReportPageFor`
 * (server-side, indexed, cursor-paginated: at most `pageSize + 1` documents per read, never `offset`); the figures above a
 * table are AGGREGATIONS (`count()` / `sum()`), so no report ever loads a collection. The query SHAPES come from
 * `domain/reportQueryPlans.ts`, which `tests/unit/indexes.test.ts` checks against firestore.indexes.json.
 *
 * Privacy: this module reads `members`, `payments` and `attendance` only. It never touches `memberMedical` or `memberPhotos`.
 */

export { REPORT_PAGE_SIZE };

function toRecord(spec: ReportSpec, d: QueryDocumentSnapshot): ReportRecord {
  switch (spec.report) {
    case 'REVENUE':
      return { kind: 'payment', payment: paymentFromDoc(d.id, d.data()) };
    case 'ATTENDANCE':
      return { kind: 'attendance', record: attendanceFromDoc(d.id, d.data()) };
    default:
      return { kind: 'member', member: memberFromDoc(d.id, d.data()) };
  }
}

/**
 * One page of a report. `next` is non-null exactly when more rows exist (the `+1` document), which is also what makes the
 * export's truncation flag exact. A range that cannot match returns an empty page WITHOUT querying.
 */
export async function listReportPageFor(
  db: Firestore,
  spec: ReportSpec,
  cursor: PageCursor | null = null,
  pageSize: number = REPORT_PAGE_SIZE,
): Promise<Page<ReportRecord>> {
  const plan = planReport(spec);
  if (plan === null) return { items: [], next: null };
  try {
    const after = (cursor as unknown as QueryDocumentSnapshot | null) ?? null;
    const docs = await fetchPlanDocs(db, plan, after, pageSize + 1);
    const rows = docs.slice(0, pageSize);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((d) => toRecord(spec, d)),
      next: docs.length > pageSize && last !== undefined ? (last as unknown as PageCursor) : null,
    };
  } catch (e) {
    throw mapReadError(e);
  }
}

async function revenueSummary(db: Firestore, range: DayRange): Promise<RevenueSummary> {
  const buckets = range.from !== null && range.to !== null ? revenueBuckets(range.from, range.to) : null;
  const [total, byMethod, bucketTotals] = await Promise.all([
    sumAndCountPlan(db, revenueTotalPlan(range)),
    Promise.all(
      REVENUE_METHODS.map(async (method) => {
        const { total: totalPaise, count } = await sumAndCountPlan(db, revenueMethodPlan(method, range));
        return { method, totalPaise, count };
      }),
    ),
    buckets
      ? Promise.all(
          buckets.buckets.map(async (b) => {
            const { total: totalPaise, count } = await sumAndCountPlan(db, revenueTotalPlan(b.range));
            return { label: b.label, totalPaise, count };
          }),
        )
      : Promise.resolve(null),
  ]);
  return {
    total: { totalPaise: total.total, count: total.count },
    byMethod,
    breakdown: buckets && bucketTotals ? { granularity: buckets.granularity, rows: bucketTotals } : null,
  };
}

/**
 * The figures above a report's table, from aggregations only:
 *   Members / Expired / Expiring  the number of rows (`count()` over the SAME plan as the table)
 *   Pending payments              total owed and members owing (`sum` + `count` over the same plan)
 *   Attendance                    PRESENT and ABSENT records in the range (two `count()`s)
 *   Revenue                       the total, the total per payment method, and per day (<= 31 days) or per IST month
 */
export async function getReportTotalsFor(db: Firestore, spec: ReportSpec): Promise<ReportTotals> {
  const range = effectiveReportRange(spec);
  if (range === 'empty') {
    return spec.report === 'REVENUE'
      ? { kind: 'revenue', total: { totalPaise: 0, count: 0 }, byMethod: [], breakdown: null }
      : spec.report === 'PENDING'
        ? { kind: 'pending', totalPaise: 0, memberCount: 0 }
        : spec.report === 'ATTENDANCE'
          ? { kind: 'attendance', present: 0, absent: 0 }
          : { kind: 'count', count: 0 };
  }
  try {
    switch (spec.report) {
      case 'REVENUE':
        return { kind: 'revenue', ...(await revenueSummary(db, range)) };
      case 'PENDING': {
        const { total, count } = await sumAndCountPlan(db, pendingReportPlan(range, true));
        return { kind: 'pending', totalPaise: total, memberCount: count };
      }
      case 'ATTENDANCE': {
        const [present, absent] = await Promise.all([
          countPlan(db, attendanceCountPlan('PRESENT', range)),
          countPlan(db, attendanceCountPlan('ABSENT', range)),
        ]);
        return { kind: 'attendance', present, absent };
      }
      default: {
        const plan = planReport(spec);
        return { kind: 'count', count: plan ? await countPlan(db, plan) : 0 };
      }
    }
  } catch (e) {
    throw mapReadError(e);
  }
}
