import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import indexes from '../../firestore.indexes.json';
import {
  currentlyCheckedInPlan,
  dayPresentPlan,
  memberHistoryPlan,
  memberPresentRangePlan,
  presentRangePlan,
  todayListPlan,
} from '../../src/domain/attendanceQueryPlans';
import { fromCivilDate } from '../../src/domain/dates';
import { dashboardQueryPlans, planMemberQuery, type QueryPlan } from '../../src/domain/memberQueryPlan';
import {
  memberPaymentsPlan,
  paymentsListPlan,
  pendingMembersPlan,
  revenueRangePlan,
  unpaidMembershipsPlan,
} from '../../src/domain/paymentQueryPlans';
import {
  attendanceCountPlan,
  pendingReportPlan,
  planReport,
  revenueMethodPlan,
  revenueTotalPlan,
} from '../../src/domain/reportQueryPlans';
import {
  endDateRangePlan,
  expiringWindowRange,
  membershipHistoryPlan,
  statusDayRange,
} from '../../src/domain/queryPredicates';
import { PAYMENT_METHODS } from '../../src/constants/enums';
import { type MemberListQuery, type MemberListStatus } from '../../src/types/member';
import { REPORT_IDS, type ReportSpec } from '../../src/types/report';

/**
 * Every members / memberships query the app can issue must be covered by a composite index in firestore.indexes.json
 * (US-8.3b): equality fields first (any order, ascending), then the range/orderBy fields in order and direction. A query
 * with at most one field, or with only equality filters, needs no composite index (Firestore's automatic single-field indexes). The plans checked here
 * are the SAME objects the services turn into Firestore queries (services/queryBuilder.ts).
 */
interface IndexDef {
  collectionGroup: string;
  fields: { fieldPath: string; order: string }[];
}

/** The ordered index fields a plan needs after its equality fields (range / orderBy / summed field), as Firestore builds them. */
function neededOrder(plan: QueryPlan): { field: string; order: string }[] {
  const orderFields = plan.orderBy.map((o) => ({ field: o.field, order: o.direction === 'asc' ? 'ASCENDING' : 'DESCENDING' }));
  // a range with no orderBy is the last (ascending) field of the index
  if (orderFields.length === 0 && plan.range) orderFields.push({ field: plan.range.field, order: 'ASCENDING' });
  // an extra inequality field (multiple-inequality query) that is not ordered explicitly is the last field of the index
  for (const r of plan.extraRanges ?? []) if (!orderFields.some((o) => o.field === r.field)) orderFields.push({ field: r.field, order: 'ASCENDING' });
  // a sum() aggregation reads the summed values from the index, so the index must contain that field: as its last field, or already ordered on
  if (plan.sumField && !orderFields.some((o) => o.field === plan.sumField)) orderFields.push({ field: plan.sumField, order: 'ASCENDING' });
  return orderFields;
}

function indexServes(ix: IndexDef, plan: QueryPlan): boolean {
  const orderFields = neededOrder(plan);
  const eq = new Set(plan.equals.map((e) => e.field));
  if (ix.collectionGroup !== (plan.collection ?? 'members')) return false;
  const lead = ix.fields.slice(0, eq.size);
  const tail = ix.fields.slice(eq.size);
  return (
    lead.every((f) => eq.has(f.fieldPath)) &&
    tail.length === orderFields.length &&
    tail.every((f, i) => f.fieldPath === orderFields[i]?.field && f.order === orderFields[i]?.order)
  );
}

function isCovered(plan: QueryPlan): boolean {
  const orderFields = neededOrder(plan);
  // Equality-only queries (no range, no orderBy) are served by merging single-field indexes: no composite needed.
  if (orderFields.length === 0) return true;
  const fieldCount = new Set([...plan.equals.map((e) => e.field), ...orderFields.map((o) => o.field)]).size;
  if (fieldCount <= 1) return true;
  return (indexes.indexes as IndexDef[]).some((ix) => indexServes(ix, plan));
}

const today = fromCivilDate(2026, 9, 19);
const browse = (status: MemberListStatus, over: Partial<Extract<MemberListQuery, { mode: 'browse' }>> = {}) =>
  planMemberQuery({ mode: 'browse', status, planId: null, expiryFrom: null, expiryTo: null, sort: 'REGISTERED', today, ...over });
const search = (kind: 'name' | 'mobile' | 'memberId') => planMemberQuery({ mode: 'search', kind, term: 'x' });

/** Every query plan the app can issue, by screen (the SAME plan objects the services run). */
const CASES: [string, unknown][] = [
    ['browse all', browse('ALL')],
    ['browse no-membership', browse('NO_MEMBERSHIP')],
    ['browse suspended', browse('SUSPENDED')],
    ['browse suspended + plan (matrix row 5)', browse('SUSPENDED', { planId: 'p1' })],
    ['browse all + plan (row 2)', browse('ALL', { planId: 'p1' })],
    ['active, expiry asc (row 3)', browse('ACTIVE', { sort: 'EXPIRY_ASC' })],
    ['expiring soon, expiry desc (row 3)', browse('EXPIRING_SOON', { sort: 'EXPIRY_DESC' })],
    ['expired + plan, expiry asc (row 4)', browse('EXPIRED', { planId: 'p1', sort: 'EXPIRY_ASC' })],
    ['expired + plan, expiry desc (row 4)', browse('EXPIRED', { planId: 'p1', sort: 'EXPIRY_DESC' })],
    ['an expiry range alone (row 3)', browse('ALL', { expiryFrom: today, expiryTo: fromCivilDate(2026, 10, 1), sort: 'EXPIRY_ASC' })],
    ['an expiry range + plan (row 4)', browse('ALL', { planId: 'p1', expiryFrom: today, sort: 'EXPIRY_DESC' })],
    ['search mobile', search('mobile')],
    ['search member id', search('memberId')],
    ['search name (both sources)', search('name')],
    ['dashboard: counts, plan distribution, next-10 table', dashboardQueryPlans(today)],
    ['expiring soon page (each window)', [1, 3, 7, 15].map((d) => endDateRangePlan(expiringWindowRange(d, today), { order: 'asc' }))],
    ['expired page', [endDateRangePlan(statusDayRange('EXPIRED', today), { order: 'desc' })]],
    ['membership history', [membershipHistoryPlan('m1')]],
    [
      'payments list: active / voided, with and without a method and a date range',
      [false, true].flatMap((voided) =>
        [null, 'UPI' as const].flatMap((method) =>
          [{ from: null, to: null }, { from: today, to: null }, { from: today, to: fromCivilDate(2026, 9, 30) }].map((r) =>
            paymentsListPlan({ ...r, method, voided }),
          ),
        ),
      ),
    ],
    ['member payment history (voided rows included)', [memberPaymentsPlan('m1')]],
    ['unpaid memberships of a member (record-payment choices)', [unpaidMembershipsPlan('m1')]],
    ['revenue of one IST month: sum(amountPaise)', [revenueRangePlan(today, fromCivilDate(2026, 9, 30))]],
    ['pending payments: list and count/sum aggregation', [pendingMembersPlan({ aggregate: false }), pendingMembersPlan({ aggregate: true })]],
    [
      'attendance: today list (all / still in / absent), member history, day and month counts, dashboard counts',
      [
        ...(['ALL', 'CHECKED_IN', 'ABSENT'] as const).map((f) => todayListPlan(f, today)),
        memberHistoryPlan('m1'),
        dayPresentPlan(today),
        currentlyCheckedInPlan(today),
        presentRangePlan(today, fromCivilDate(2026, 9, 30)),
        memberPresentRangePlan('m1', today, fromCivilDate(2026, 9, 30)),
      ],
    ],
    [
      'reports (Phase 6): every report, every combination of open / bounded dates, every attendance status',
      REPORT_IDS.flatMap((report) =>
        [null, today].flatMap((from) =>
          [null, fromCivilDate(2026, 10, 1)].flatMap((to) =>
            (report === 'ATTENDANCE' ? (['ALL', 'PRESENT', 'ABSENT'] as const) : ([undefined] as const)).flatMap((status) => {
              const spec = { report, from, to, today, ...(status ? { status } : {}) } as ReportSpec;
              const plan = planReport(spec);
              return plan ? [plan] : [];
            }),
          ),
        ),
      ),
    ],
    [
      'report totals: revenue sum (all, per method, per bucket), pending sum + count, attendance counts',
      [null, today].flatMap((from) =>
        [null, fromCivilDate(2026, 10, 1)].flatMap((to) => [
          revenueTotalPlan({ from, to }),
          ...PAYMENT_METHODS.map((m) => revenueMethodPlan(m, { from, to })),
          pendingReportPlan({ from, to }, true),
          attendanceCountPlan('PRESENT', { from, to }),
          attendanceCountPlan('ABSENT', { from, to }),
        ]),
      ),
    ],
    [
      'duplicate-mobile lookup (Staff: live only)',
      [{ equals: [{ field: 'deleted', value: false }, { field: 'searchMobile', value: '9876543210' }], orderBy: [] }],
    ],
];

describe('firestore.indexes.json covers every members / memberships / payments / attendance / report query (Phase 2 to 6)', () => {
  it.each(CASES)('%s', (_label, plans) => {
    expect((plans as QueryPlan[]).length).toBeGreaterThan(0);
    for (const plan of plans as QueryPlan[]) expect(isCovered(plan), JSON.stringify(plan)).toBe(true);
  });

  it('the checker is not vacuous: an uncovered plan is rejected', () => {
    expect(
      isCovered({ equals: [{ field: 'deleted', value: false }], orderBy: [{ field: 'createdAt', direction: 'asc' }] }),
    ).toBe(false);
    // a plan on a plan-filtered expiry sort needs the planId index: this one asks for a field no index has
    expect(
      isCovered({ equals: [{ field: 'deleted', value: false }, { field: 'membership.city', value: 'x' }], orderBy: [{ field: 'createdAt', direction: 'desc' }] }),
    ).toBe(false);
  });

  it('an aggregation needs its summed field in the index: revenue is not covered without amountPaise', () => {
    expect(isCovered({ ...revenueRangePlan(today, today), sumField: 'somethingElse' })).toBe(false);
  });

  it('there is no plan for search combined with a status filter (matrix row 8)', () => {
    for (const plan of search('name')) expect(plan.equals.map((e) => e.field)).toEqual(['deleted']);
  });

  it('an expiry sort without a date filter has no plan of its own (matrix row 9): it falls back to registered order', () => {
    const plan = browse('ALL', { sort: 'EXPIRY_ASC' })[0];
    expect(plan?.orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }]);
  });

  it('an empty status/expiry intersection issues no query at all', () => {
    // Expired (before today) with an expiry range that starts today can match nothing
    expect(browse('EXPIRED', { expiryFrom: today })).toEqual([]);
  });
});

describe('index audit (US-8.3b)', () => {
  const declared = indexes.indexes as IndexDef[];
  const corpus = CASES.flatMap(([, plans]) => plans as QueryPlan[]);

  it('every declared composite index is used by at least one query (an unused index only costs write time and storage)', () => {
    const unused = declared.filter((ix) => !corpus.some((plan) => neededOrder(plan).length > 0 && indexServes(ix, plan)));
    expect(unused.map((ix) => `${ix.collectionGroup}: ${ix.fields.map((f) => `${f.fieldPath} ${f.order}`).join(', ')}`)).toEqual([]);
  });

  it('there are no duplicate indexes', () => {
    const keys = declared.map((ix) => `${ix.collectionGroup}|${ix.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every index is COLLECTION scope (no collection-group query exists) and starts with an equality field of its collection', () => {
    for (const ix of declared) expect(ix).toMatchObject({ queryScope: 'COLLECTION' });
  });

  it('the app has no query outside the plans except single-field / equality-only ones (which need no composite index)', () => {
    // Firestore serves these from automatic single-field indexes. A NEW ad-hoc query has to be added here on purpose (with the
    // reasoning) or, better, be written as a plan so the tests above cover it.
    const allowed: Record<string, string[]> = {
      'memberTransactions.ts': ["where('searchMobile', '==', mobile)", "where('deleted', '==', false), where('searchMobile', '==', mobile)"],
      'planQueries.ts': ["orderBy('name')", "where('nameLower', '==', normalizeText(name))", "where('planId', '==', planId)"],
      'trainerService.ts': ["orderBy('name')", "where('trainerId', '==', trainerId)"],
    };
    const dir = resolve(process.cwd(), 'src/services');
    const found: string[] = [];
    let scanned = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      if (file === 'queryBuilder.ts' || file === 'reconcileQueries.ts') continue; // the plan builder itself / the manual diagnostic scan (document-id order)
      const text = readFileSync(resolve(dir, file), 'utf8');
      for (const m of text.matchAll(/\b(where|orderBy)\(([^)]*)\)/g)) {
        const call = `${m[1]}(${m[2]})`;
        scanned += 1;
        if (!(allowed[file] ?? []).some((a) => a.includes(call))) found.push(`${file}: ${call}`);
      }
    }
    expect(scanned, 'the scan found no query calls at all: the pattern is broken').toBeGreaterThanOrEqual(8);
    expect(found).toEqual([]);
  });
});
