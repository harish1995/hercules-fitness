import { db } from '../firebase/app';
import { type Clock } from '../domain/dates';
import {
  type AttendanceDashboardStats,
  type AttendanceRecord,
  type CheckInResult,
  type MarkAbsentResult,
  type MonthlyAttendanceDay,
  type TodayAttendanceFilter,
} from '../types/attendance';
import { type Actor, type Page, type PageCursor } from '../types/member';
import {
  getAttendanceDashboardStatsFor,
  getMemberMonthPresentCountsFor,
  getMonthlyDayCountsFor,
  getTodayAttendanceRecord,
  getTodayCounts,
  listMemberAttendancePageFor,
  listTodayAttendancePageFor,
} from './attendanceQueries';
import { checkInTx, checkOutTx, markAbsentTx } from './attendanceTransactions';

/** App-facing attendance API (check-in / check-out / absent, lists, monthly report, dashboard figures), bound to the app's Firestore. */

export const checkIn = (params: { memberDocId: string; actor: Actor; confirmed?: boolean; clock?: Clock }): Promise<CheckInResult> =>
  checkInTx({ db, ...params });

export const checkOut = (params: { memberDocId: string; actor: Actor; clock?: Clock }): Promise<{ attendanceId: string; memberName: string }> =>
  checkOutTx({ db, ...params });

export const markAbsent = (params: { memberDocId: string; actor: Actor; clock?: Clock }): Promise<MarkAbsentResult> =>
  markAbsentTx({ db, ...params });

export const getTodayAttendance = (memberDocId: string, clock?: Clock): Promise<AttendanceRecord | null> =>
  getTodayAttendanceRecord(db, memberDocId, clock);

export const listTodayAttendance = (filter: TodayAttendanceFilter, today: Date, cursor: PageCursor | null = null): Promise<Page<AttendanceRecord>> =>
  listTodayAttendancePageFor(db, filter, today, cursor);

export const listMemberAttendance = (memberDocId: string, cursor: PageCursor | null = null): Promise<Page<AttendanceRecord>> =>
  listMemberAttendancePageFor(db, memberDocId, cursor);

export const getTodayAttendanceCounts = (clock?: Clock) => getTodayCounts(db, clock);

export const getAttendanceDashboardStats = (clock?: Clock): Promise<AttendanceDashboardStats> => getAttendanceDashboardStatsFor(db, clock);

export const getMonthlyDayCounts = (year: number, month: number, clock?: Clock): Promise<MonthlyAttendanceDay[]> =>
  getMonthlyDayCountsFor(db, year, month, clock);

export const getMemberMonthPresentCounts = (memberDocIds: readonly string[], year: number, month: number): Promise<Record<string, number>> =>
  getMemberMonthPresentCountsFor(db, memberDocIds, year, month);
