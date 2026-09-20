import { type AttendanceStatus } from '../constants/enums';
import { type MembershipStatus } from '../domain/status';

/**
 * Attendance types (architecture §2.2, FR-7). Firebase-free: Timestamps are converted to `Date` in the services.
 * `date` is a calendar day (00:00 IST of the IST day of the check-in); `checkInAt` / `checkOutAt` are instants written with
 * `serverTimestamp()` and checked against `request.time` by the rules.
 */

/** attendance/{memberDocId}_{YYYYMMDD}: ONE record per member per IST day (the deterministic id is what enforces it). */
export interface AttendanceRecord {
  /** the document id, `{memberDocId}_{YYYYMMDD}` */
  id: string;
  memberDocId: string;
  /** readable `GYM-2026-0001` (snapshot) */
  memberId: string;
  /** snapshot */
  memberName: string;
  /** 00:00 IST of the attendance day */
  date: Date;
  /** `YYYYMMDD` (IST) */
  dateKey: string;
  status: AttendanceStatus;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  /** true once a check-out was recorded: the equality flag behind "currently checked in" */
  checkedOut: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

/** The Attendance page's list filter: everything today, only members still in the gym, or the ones marked absent. */
export type TodayAttendanceFilter = 'ALL' | 'CHECKED_IN' | 'ABSENT';

export interface CheckInResult {
  attendanceId: string;
  memberName: string;
  /** the membership status the check-in was evaluated against (read inside the transaction) */
  membershipStatus: MembershipStatus;
  daysRemaining: number | null;
  /** true when an ABSENT record for today was turned into PRESENT (US-5.3b) */
  fromAbsent: boolean;
}

export interface MarkAbsentResult {
  attendanceId: string;
  memberName: string;
}

export interface MonthlyAttendanceDay {
  /** 00:00 IST of the day */
  date: Date;
  /** PRESENT records dated that day */
  present: number;
}

export interface MonthlyAttendanceByMonth {
  year: number;
  month: number;
  label: string;
  /** PRESENT records dated in that IST month */
  count: number;
}

/** Dashboard attendance figures (US-5.7): three kinds of count aggregation, never a collection read. */
export interface AttendanceDashboardStats {
  /** PRESENT records dated today (IST), checked out or not */
  todayPresent: number;
  /** today's PRESENT records with no check-out: resets at 00:00 IST */
  currentlyCheckedIn: number;
  /** the last 12 IST months, oldest first; the LAST entry is the current month */
  byMonth: MonthlyAttendanceByMonth[];
}
