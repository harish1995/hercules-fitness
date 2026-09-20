import { type AttendanceRecord } from '../types/attendance';
import { type Member } from '../types/member';
import { formatIstDate, formatIstTime, istDayKey, istDayStart, systemClock, type Clock } from './dates';
import {
  calculateMembershipStatus,
  describeDaysRemaining,
  InvalidPeriodError,
  type MembershipStatus,
} from './status';

/**
 * Attendance business rules (FR-7, NEW-12, NEW-13). Pure and Firebase-free: the check-in transaction, the dialog and the unit
 * tests all use these functions, so the rule the screen shows is the rule the service enforces.
 */

/** `{memberDocId}_{YYYYMMDD}`: the deterministic id that makes "one record per member per IST day" structural (Q9). */
export function attendanceDocId(memberDocId: string, at: Date): string {
  return `${memberDocId}_${istDayKey(at)}`;
}

/** How a check-in is treated for the member's membership status (NEW-12). */
export type CheckInAction = 'ALLOW' | 'CONFIRM' | 'BLOCK';

export interface CheckInEvaluation {
  action: CheckInAction;
  status: MembershipStatus;
  daysRemaining: number | null;
  /** One line for the screen, or null when nothing needs saying (an ACTIVE member). */
  message: string | null;
}

type EvaluatedMember = Pick<Member, 'suspended' | 'membership'>;

/**
 * NEW-12, from the member's stored end date + suspended flag on the IST calendar day of `clock`:
 *   SUSPENDED      BLOCK   no check-in at all (also refused by the security rules);
 *   EXPIRED        CONFIRM a warning and an explicit confirmation;
 *   NO_MEMBERSHIP  CONFIRM the same (the requirements are silent; treated like EXPIRED: the member has no valid membership);
 *   EXPIRING_SOON  ALLOW   the days remaining are shown;
 *   ACTIVE         ALLOW.
 * Dates that are corrupt (end before start) cannot be trusted, so they need a confirmation too.
 */
export function evaluateCheckIn(member: EvaluatedMember, clock: Clock = systemClock): CheckInEvaluation {
  let status: MembershipStatus;
  let daysRemaining: number | null;
  try {
    ({ status, daysRemaining } = calculateMembershipStatus(member.membership.startDate, member.membership.endDate, {
      suspended: member.suspended,
      clock,
    }));
  } catch (e) {
    if (!(e instanceof InvalidPeriodError)) throw e;
    return {
      action: member.suspended ? 'BLOCK' : 'CONFIRM',
      status: member.suspended ? 'SUSPENDED' : 'NO_MEMBERSHIP',
      daysRemaining: null,
      message: member.suspended
        ? 'This member is suspended, so they cannot be checked in.'
        : 'The membership dates on record are inconsistent, so the membership cannot be verified.',
    };
  }
  switch (status) {
    case 'SUSPENDED':
      return { action: 'BLOCK', status, daysRemaining, message: 'This member is suspended, so they cannot be checked in. An Admin can reactivate the member.' };
    case 'EXPIRED': {
      const end = member.membership.endDate;
      return {
        action: 'CONFIRM',
        status,
        daysRemaining,
        message: `The membership has expired${end ? ` on ${formatIstDate(end)}` : ''} (${describeDaysRemaining(daysRemaining)?.toLowerCase() ?? 'expired'}).`,
      };
    }
    case 'NO_MEMBERSHIP':
      return { action: 'CONFIRM', status, daysRemaining, message: 'This member has no membership.' };
    case 'EXPIRING_SOON':
      return { action: 'ALLOW', status, daysRemaining, message: `Membership expiring soon: ${describeDaysRemaining(daysRemaining)?.toLowerCase() ?? ''}.` };
    case 'ACTIVE':
      return { action: 'ALLOW', status, daysRemaining, message: null };
  }
}

/** True when the record is dated the IST day of `now`. */
export function isToday(record: Pick<AttendanceRecord, 'date'>, now: Date): boolean {
  return istDayStart(record.date).getTime() === istDayStart(now).getTime();
}

/**
 * "Currently checked in" (FR-7, D-8): TODAY's record, status PRESENT with a check-in time and no check-out. A forgotten
 * check-out on an earlier day is never "currently in" (the count resets at 00:00 IST).
 */
export function isCurrentlyCheckedIn(record: AttendanceRecord, now: Date): boolean {
  return record.status === 'PRESENT' && record.checkInAt !== null && !record.checkedOut && isToday(record, now);
}

/** What the "Check-out" column shows for a record (US-4.4a-style empty states: never a blank, US-5.2c). */
export function checkOutLabel(record: AttendanceRecord, now: Date): string {
  if (record.status !== 'PRESENT') return '—';
  if (record.checkOutAt !== null) return formatIstTime(record.checkOutAt);
  return isToday(record, now) ? 'Still in' : 'Not recorded';
}

/** "Checked in at 09:05": used in refusals and dialogs. */
export function describeCheckIn(record: Pick<AttendanceRecord, 'checkInAt'>): string {
  return record.checkInAt ? `at ${formatIstTime(record.checkInAt)}` : '';
}
