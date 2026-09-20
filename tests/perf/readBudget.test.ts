import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type * as FirestoreModule from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addIstDays, todayIstStart } from '../../src/domain/dates';
import { reconcile } from '../../src/domain/reconcile';
import { EXPORT_MAX_ROWS } from '../../src/domain/reports';
import { getAttendanceDashboardStatsFor, listTodayAttendancePageFor } from '../../src/services/attendanceQueries';
import { exportReportFor } from '../../src/services/reportExport';
import { getReportTotalsFor, listReportPageFor } from '../../src/services/reportQueries';
import { getDashboardStatsFor, listExpiredPage, listExpiringPage, listMembersPage } from '../../src/services/memberQueries';
import { getPaymentDashboardStatsFor, listPaymentsPageFor, listPendingMembersPageFor } from '../../src/services/paymentQueries';
import { readReconcileInput } from '../../src/services/reconcileQueries';
import { type MemberListQuery } from '../../src/types/member';
import { REPORT_IDS, type ReportSpec } from '../../src/types/report';
import { createTestEnv, dbFor, seedUsers } from '../rules/setup';
import { buildDataset, PLANS, writeDataset, type DatasetStats } from './dataset';

/**
 * US-8.3a: read cost of every screen on a 10k+ member dataset, MEASURED against the Firestore emulator with the real rules.
 *
 * What is counted (the emulator has no billing, so this applies the documented Firestore billing MODEL to what the app really asks for):
 *   docs   documents returned by getDocs / getDoc            = 1 billed read each (an empty result is billed 1)
 *   aggs   getCountFromServer / getAggregateFromServer calls  = billed ceil(index entries scanned / 1000), minimum 1 each. The entries
 *          scanned are the matching documents: a count() returns them; for sum() they are counted by an out-of-band count() that is
 *          NOT itself metered.
 *   rules  every request evaluates the rules, which `get()` the caller's users/{uid} document = 1 more billed read per request
 * The budgets below were fixed BEFORE measuring (see the README, "Performance"). Verify the billing model and the free-plan quota
 * against the current Firebase documentation before relying on the absolute numbers (architecture R-5).
 */
const meter = vi.hoisted(() => ({ docs: 0, requests: 0, aggs: 0, entries: 0, billedAgg: 0 }));
const reset = () => Object.assign(meter, { docs: 0, requests: 0, aggs: 0, entries: 0, billedAgg: 0 });

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof FirestoreModule>();
  const billed = (entries: number) => Math.max(1, Math.ceil(entries / 1000));
  return {
    ...actual,
    getDocs: async (q: never) => {
      const snap = await actual.getDocs(q);
      meter.requests += 1;
      meter.docs += Math.max(1, snap.size);
      return snap;
    },
    getDoc: async (r: never) => {
      const snap = await actual.getDoc(r);
      meter.requests += 1;
      meter.docs += 1;
      return snap;
    },
    getCountFromServer: async (q: never) => {
      const snap = await actual.getCountFromServer(q);
      meter.requests += 1;
      meter.aggs += 1;
      meter.entries += snap.data().count;
      meter.billedAgg += billed(snap.data().count);
      return snap;
    },
    getAggregateFromServer: async (q: never, spec: never) => {
      const snap = await actual.getAggregateFromServer(q, spec);
      const scanned = (await actual.getCountFromServer(q)).data().count; // not metered: it only tells us what the sum scanned
      meter.requests += 1;
      meter.aggs += 1;
      meter.entries += scanned;
      meter.billedAgg += billed(scanned);
      return snap;
    },
  };
});

const MEMBER_COUNT = Number(process.env.PERF_MEMBERS ?? 10_500);
const admin = { uid: 'admin', name: 'Owner', role: 'ADMIN' as const };
let env: RulesTestEnvironment;
let stats: DatasetStats;
let db: ReturnType<typeof dbFor>;
const today = todayIstStart();

interface Row {
  screen: string;
  docs: number;
  aggs: number;
  entries: number;
  rules: number;
  billed: number;
}
const rows: Row[] = [];

async function measure<T>(screen: string, run: () => Promise<T>): Promise<{ row: Row; result: T }> {
  reset();
  const result = await run();
  const row: Row = {
    screen,
    docs: meter.docs,
    aggs: meter.aggs,
    entries: meter.entries,
    rules: meter.requests,
    billed: meter.docs + meter.billedAgg + meter.requests,
  };
  rows.push(row);
  return { row, result };
}

const browse = (over: Partial<Extract<MemberListQuery, { mode: 'browse' }>> = {}): MemberListQuery => ({
  mode: 'browse', status: 'ALL', planId: null, expiryFrom: null, expiryTo: null, sort: 'REGISTERED', today, ...over,
});

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
  await seedUsers(env);
  const started = Date.now();
  const built = buildDataset(MEMBER_COUNT);
  stats = built.stats;
  await writeDataset(env, built.docs);
  db = dbFor(env, 'admin');
  console.info(`\nDATASET  ${built.docs.length} documents written in ${((Date.now() - started) / 1000).toFixed(1)} s: ${JSON.stringify(stats)}\n`);
});
afterAll(async () => {
  await env.cleanup();
});

describe('the dataset is real and consistent (so the numbers mean something)', () => {
  it('has 10,000+ members and reconciles with zero drift', async () => {
    expect(stats.members).toBeGreaterThanOrEqual(10_000);
    reset();
    const r = reconcile(await readReconcileInput(db, { pageSize: 1000 }));
    reset();
    expect(r.checked.members).toBe(MEMBER_COUNT);
    expect(r.errors, JSON.stringify(r.drifts.slice(0, 5))).toBe(0);
  });
});

describe('list screens read ONE page (page size 25, +1 to know whether a next page exists) however large the collection is', () => {
  const PAGE_DOCS = 26;

  it.each([
    ['Members list: all, newest first', () => listMembersPage(db, browse())],
    ['Members list: status Active + sort by expiry', () => listMembersPage(db, browse({ status: 'ACTIVE', sort: 'EXPIRY_ASC' }))],
    ['Members list: status Expiring soon', () => listMembersPage(db, browse({ status: 'EXPIRING_SOON' }))],
    ['Members list: status Expired', () => listMembersPage(db, browse({ status: 'EXPIRED' }))],
    ['Members list: status Suspended', () => listMembersPage(db, browse({ status: 'SUSPENDED' }))],
    ['Members list: status No membership', () => listMembersPage(db, browse({ status: 'NO_MEMBERSHIP' }))],
    ['Members list: plan filter', () => listMembersPage(db, browse({ planId: PLANS[1].id }))],
    ['Members list: name search "ra"', () => listMembersPage(db, { mode: 'search', kind: 'name', term: 'ra' })],
    ['Members list: mobile prefix', () => listMembersPage(db, { mode: 'search', kind: 'mobile', term: '9100005' })],
    ['Members list: member ID prefix', () => listMembersPage(db, { mode: 'search', kind: 'memberId', term: 'GYM-' })],
    ['Expiring soon page (7 days)', () => listExpiringPage(db, 7, null, today)],
    ['Expiring soon page (15 days)', () => listExpiringPage(db, 15, null, today)],
    ['Expired page', () => listExpiredPage(db, null, today)],
    ['Payments page', () => listPaymentsPageFor(db, { from: null, to: null, method: null, voided: false })],
    ['Pending payments page', () => listPendingMembersPageFor(db)],
    ["Attendance: today's list", () => listTodayAttendancePageFor(db, 'ALL', today)],
  ] as const)('%s', async (screen, run) => {
    const { row, result } = await measure(screen, run as () => Promise<{ items: unknown[]; next: unknown }>);
    expect(row.docs, screen).toBeLessThanOrEqual(PAGE_DOCS);
    expect(row.aggs).toBe(0);
    expect(result.items.length, `${screen} returned no rows: the dataset does not exercise it`).toBeGreaterThan(0);
  });

  it('a page deep into the list costs the same as page 1 (cursors, never offsets)', async () => {
    const first = await listMembersPage(db, browse());
    let cursor = first.next;
    for (let i = 0; i < 20 && cursor; i++) cursor = (await listMembersPage(db, browse(), cursor)).next; // walk 20 pages (not metered below)
    const { row } = await measure('Members list: page 22 (cursor)', () => listMembersPage(db, browse(), cursor));
    expect(row.docs).toBeLessThanOrEqual(PAGE_DOCS);
  });
});

describe('the dashboard: bounded aggregations + at most 10 table documents, never a collection read', () => {
  // Budget fixed before measuring: the FR-9 rule (<= 10 documents for the table, plus the plan list for the chart) and <= 200 billed reads
  // for a full load (members + money + attendance figures) at 10k members.
  const DASHBOARD_BILLED_BUDGET = 200;
  const TABLE_DOCS = 10;

  it('measures the three dashboard loads', async () => {
    const members = await measure('Dashboard: member cards, charts, next-10 table', () => getDashboardStatsFor(db));
    const money = await measure('Dashboard: pending payments, revenue by month', () => getPaymentDashboardStatsFor(db));
    const attendance = await measure('Dashboard: attendance today and by month', () => getAttendanceDashboardStatsFor(db));
    const total: Row = {
      screen: 'Dashboard TOTAL (one load)',
      docs: members.row.docs + money.row.docs + attendance.row.docs,
      aggs: members.row.aggs + money.row.aggs + attendance.row.aggs,
      entries: members.row.entries + money.row.entries + attendance.row.entries,
      rules: members.row.rules + money.row.rules + attendance.row.rules,
      billed: members.row.billed + money.row.billed + attendance.row.billed,
    };
    rows.push(total);
    // the documents read are the next-10 table + the plan list of the chart: independent of the member count
    expect(total.docs).toBeLessThanOrEqual(TABLE_DOCS + PLANS.length);
    expect(total.billed, `dashboard cost ${total.billed} billed reads`).toBeLessThanOrEqual(DASHBOARD_BILLED_BUDGET);
    // the numbers on screen are right (this is also the "counts agree" check on a big dataset)
    const s = members.result.statusCounts;
    expect(s.total).toBe(stats.liveMembers);
    expect(s.total).toBe(s.active + s.expiringSoon + s.expired + s.suspended + s.noMembership);
    expect(s).toMatchObject({ active: stats.byStatus.ACTIVE, expiringSoon: stats.byStatus.EXPIRING_SOON, expired: stats.byStatus.EXPIRED, suspended: stats.byStatus.SUSPENDED, noMembership: stats.byStatus.NO_MEMBERSHIP });
    expect(members.result.nextExpiring).toHaveLength(10);
    expect(attendance.result.todayPresent).toBeGreaterThan(0);
    expect(money.result.pending.memberCount).toBeGreaterThan(0);
  });
});

describe('reports: one page + bounded totals; a CSV export reads at most the cap', () => {
  const start = addIstDays(today, -30);
  const specs = (report: ReportSpec['report']): ReportSpec =>
    ({ report, from: report === 'EXPIRING' ? today : report === 'REVENUE' || report === 'ATTENDANCE' ? start : null, to: report === 'EXPIRING' ? addIstDays(today, 7) : report === 'REVENUE' || report === 'ATTENDANCE' ? today : null, today, status: 'ALL' }) as ReportSpec;

  it.each(REPORT_IDS.map((r) => [r] as const))('%s report: first page and totals', async (report) => {
    const spec = specs(report);
    const page = await measure(`Report ${report}: first page`, () => listReportPageFor(db, spec));
    expect(page.row.docs).toBeLessThanOrEqual(26);
    const totals = await measure(`Report ${report}: totals`, () => getReportTotalsFor(db, spec));
    expect(totals.row.docs).toBe(0);
  });

  it('a CSV export of the Members report reads at most the 5,000-row cap (in pages of 250 + 1)', async () => {
    const { row, result } = await measure('CSV export: Members report at the 5,000-row cap', () => exportReportFor(db, { spec: specs('MEMBERS'), actor: admin }));
    expect(result.rowCount).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(true);
    expect(row.docs).toBeLessThanOrEqual(EXPORT_MAX_ROWS + Math.ceil(EXPORT_MAX_ROWS / 250));
  });
});

describe('summary', () => {
  it('prints the measured table (copy it into the README)', () => {
    const lines = [
      '| Screen | Documents read | Aggregations | Index entries scanned | Rules reads (users/{uid}) | Billed reads (model) |',
      '|---|---:|---:|---:|---:|---:|',
      ...rows.map((r) => `| ${r.screen} | ${r.docs} | ${r.aggs} | ${r.entries} | ${r.rules} | ${r.billed} |`),
    ];
    console.info(`\nREAD COUNTS at ${stats.members} members (${stats.liveMembers} live), ${stats.memberships} memberships, ${stats.payments} payments, ${stats.attendance} attendance records\n${lines.join('\n')}\n`);
    expect(rows.length).toBeGreaterThan(20);
  });
});
