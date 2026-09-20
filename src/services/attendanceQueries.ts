import { doc, getDoc, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { attendanceDocId } from '../domain/attendance';
import {
  ATTENDANCE_PAGE_SIZE,
  currentlyCheckedInPlan,
  dayPresentPlan,
  memberHistoryPlan,
  memberPresentRangePlan,
  presentRangePlan,
  todayListPlan,
} from '../domain/attendanceQueryPlans';
import { addIstDays, istMonthRange, lastIstMonths, systemClock, todayIstStart, type Clock } from '../domain/dates';
import { type QueryPlan } from '../domain/queryPredicates';
import {
  type AttendanceDashboardStats,
  type AttendanceRecord,
  type MonthlyAttendanceDay,
  type TodayAttendanceFilter,
} from '../types/attendance';
import { type Page, type PageCursor } from '../types/member';
import { mapReadError } from './errors';
import { attendanceFromDoc } from './firestoreConverters';
import { countPlan, fetchPlanDocs } from './queryBuilder';

/**
 * Read paths for attendance (architecture §5.4, §5.6). Every list is server-side, indexed and cursor-paginated (`startAfter`,
 * never `offset`, at most `pageSize + 1` documents); every figure is a `count()` AGGREGATION, so nothing here reads a whole
 * collection. The query SHAPES come from `domain/attendanceQueryPlans.ts`, which a unit test checks against
 * firestore.indexes.json.
 */

export { ATTENDANCE_PAGE_SIZE };

async function pageOf(db: Firestore, plan: QueryPlan, cursor: PageCursor | null, pageSize: number): Promise<Page<AttendanceRecord>> {
  try {
    const after = (cursor as unknown as QueryDocumentSnapshot | null) ?? null;
    const docs = await fetchPlanDocs(db, plan, after, pageSize + 1);
    const rows = docs.slice(0, pageSize);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((d) => attendanceFromDoc(d.id, d.data())),
      next: docs.length > pageSize && last !== undefined ? (last as unknown as PageCursor) : null,
    };
  } catch (e) {
    throw mapReadError(e);
  }
}

/** Today's records (IST day of `today`), by filter, newest check-in first (US-5.4a). */
export function listTodayAttendancePageFor(
  db: Firestore,
  filter: TodayAttendanceFilter,
  today: Date,
  cursor: PageCursor | null = null,
  pageSize: number = ATTENDANCE_PAGE_SIZE,
): Promise<Page<AttendanceRecord>> {
  return pageOf(db, todayListPlan(filter, today), cursor, pageSize);
}

/** One member's attendance history, newest day first (US-5.5a). */
export function listMemberAttendancePageFor(
  db: Firestore,
  memberDocId: string,
  cursor: PageCursor | null = null,
  pageSize: number = ATTENDANCE_PAGE_SIZE,
): Promise<Page<AttendanceRecord>> {
  return pageOf(db, memberHistoryPlan(memberDocId), cursor, pageSize);
}

/** The member's record for the IST day of `clock`: ONE document read by its deterministic id (no query). */
export async function getTodayAttendanceRecord(db: Firestore, memberDocId: string, clock: Clock = systemClock): Promise<AttendanceRecord | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.attendance, attendanceDocId(memberDocId, clock())));
    const data = snap.data();
    return snap.exists() && data ? attendanceFromDoc(snap.id, data) : null;
  } catch (e) {
    throw mapReadError(e);
  }
}

/** Today's PRESENT count and the "currently checked in" count (US-5.7a): two aggregations. */
export async function getTodayCounts(db: Firestore, clock: Clock = systemClock): Promise<Pick<AttendanceDashboardStats, 'todayPresent' | 'currentlyCheckedIn'>> {
  const today = todayIstStart(clock);
  try {
    const [todayPresent, currentlyCheckedIn] = await Promise.all([
      countPlan(db, dayPresentPlan(today)),
      countPlan(db, currentlyCheckedInPlan(today)),
    ]);
    return { todayPresent, currentlyCheckedIn };
  } catch (e) {
    throw mapReadError(e);
  }
}

/**
 * PRESENT records per IST month over the last 12 months, oldest first (US-5.7b): 12 `count()` aggregations in parallel. The
 * month bounds are IST midnights, so a record at 23:50 IST on the last day of a month is in that month (US-5.6b).
 */
export async function getAttendanceByMonth(db: Firestore, clock: Clock = systemClock): Promise<AttendanceDashboardStats['byMonth']> {
  const months = lastIstMonths(12, clock);
  return Promise.all(
    months.map(async (m) => {
      const { start, endExclusive } = istMonthRange(m.year, m.month);
      // `date` is stored at 00:00 IST, so [start, endExclusive) is exactly the inclusive range [start, endExclusive - 1 ms]
      return { ...m, count: await countPlan(db, presentRangePlan(start, new Date(endExclusive.getTime() - 1))) };
    }),
  );
}

export async function getAttendanceDashboardStatsFor(db: Firestore, clock: Clock = systemClock): Promise<AttendanceDashboardStats> {
  try {
    const [counts, byMonth] = await Promise.all([getTodayCounts(db, clock), getAttendanceByMonth(db, clock)]);
    return { ...counts, byMonth };
  } catch (e) {
    throw mapReadError(e);
  }
}

/**
 * The monthly report's per-day figures (US-5.6): one `count()` per IST day of the month, up to today (a future day cannot have
 * records). At most 31 aggregations in parallel; equality-only queries, so no composite index is needed.
 */
export async function getMonthlyDayCountsFor(db: Firestore, year: number, month: number, clock: Clock = systemClock): Promise<MonthlyAttendanceDay[]> {
  const { start, endExclusive } = istMonthRange(year, month);
  const today = todayIstStart(clock);
  const days: Date[] = [];
  for (let d = start; d.getTime() < endExclusive.getTime() && d.getTime() <= today.getTime(); d = addIstDays(d, 1)) days.push(d);
  try {
    return await Promise.all(days.map(async (date) => ({ date, present: await countPlan(db, dayPresentPlan(date)) })));
  } catch (e) {
    throw mapReadError(e);
  }
}

/** PRESENT days of each given member in the month (US-5.6a): one `count()` per member of the page being shown (<= 25). */
export async function getMemberMonthPresentCountsFor(
  db: Firestore,
  memberDocIds: readonly string[],
  year: number,
  month: number,
): Promise<Record<string, number>> {
  const { start, endExclusive } = istMonthRange(year, month);
  const end = new Date(endExclusive.getTime() - 1);
  try {
    const counted = await Promise.all(memberDocIds.map(async (id) => [id, await countPlan(db, memberPresentRangePlan(id, start, end))] as const));
    return Object.fromEntries(counted);
  } catch (e) {
    throw mapReadError(e);
  }
}
