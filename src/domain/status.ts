import { diffIstDays, istDayStart, systemClock, todayIstStart, type Clock } from './dates';

/**
 * Membership status (FR-4, D-1..D-5, architecture §6.3). ONE implementation used by the list badge, the profile, the
 * dashboard-adjacent tables and the Expiring / Expired pages; the query side (`queryPredicates.ts`) expresses the same
 * boundaries as date ranges, and both are unit-tested against the D-4 table so the numbers can never disagree.
 *
 * Nothing here reads the device time zone: "today" is the IST calendar day of the injected clock.
 */

/** A membership is EXPIRING_SOON for 0..7 whole IST days before its end date (inclusive, D-4). */
export const EXPIRING_SOON_MAX_DAYS = 7;

export type MembershipStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'NO_MEMBERSHIP';

export interface StatusResult {
  status: MembershipStatus;
  /** endDate - today in IST calendar days: 0 on the end date, negative once expired. null when there is no end date. */
  daysRemaining: number | null;
  /** The start date is after today (NEW-5): only a label ("Starts DD/MM/YYYY"), never a status. */
  startsInFuture: boolean;
}

/** An end date before its start date is corrupt data and is rejected, never silently computed (US-3.4e). */
export class InvalidPeriodError extends Error {
  constructor() {
    super('The membership end date is before its start date.');
    this.name = 'InvalidPeriodError';
  }
}

export interface StatusOptions {
  /** The member-level stored flag (NEW-8). */
  suspended?: boolean;
  clock?: Clock;
}

/**
 * D-4, evaluated in order: suspended -> SUSPENDED (daysRemaining still returned); daysRemaining < 0 -> EXPIRED;
 * 0..7 -> EXPIRING_SOON; >= 8 -> ACTIVE. No end date at all -> NO_MEMBERSHIP (D-5). `startDate` is optional: when
 * given, end < start throws InvalidPeriodError. A 1-day plan has end == start, which is valid.
 */
export function calculateMembershipStatus(
  startDate: Date | null,
  endDate: Date | null,
  opts: StatusOptions = {},
): StatusResult {
  const clock = opts.clock ?? systemClock;
  if (endDate === null) {
    // "Suspended" is only ever set on a member that has a membership (rules + transaction), so this is the plain case.
    return { status: opts.suspended ? 'SUSPENDED' : 'NO_MEMBERSHIP', daysRemaining: null, startsInFuture: false };
  }
  if (startDate !== null && istDayStart(endDate).getTime() < istDayStart(startDate).getTime()) {
    throw new InvalidPeriodError();
  }
  const today = todayIstStart(clock);
  const daysRemaining = diffIstDays(today, endDate);
  const startsInFuture = startDate !== null && diffIstDays(today, startDate) > 0;

  if (opts.suspended) return { status: 'SUSPENDED', daysRemaining, startsInFuture };
  if (daysRemaining < 0) return { status: 'EXPIRED', daysRemaining, startsInFuture };
  if (daysRemaining <= EXPIRING_SOON_MAX_DAYS) return { status: 'EXPIRING_SOON', daysRemaining, startsInFuture };
  return { status: 'ACTIVE', daysRemaining, startsInFuture };
}

export const STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
  SUSPENDED: 'Suspended',
  NO_MEMBERSHIP: 'No membership',
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "Expires today", "1 day left", "12 days left", "Expired 1 day ago" (US-3.13a). null for no end date. */
export function describeDaysRemaining(daysRemaining: number | null): string | null {
  if (daysRemaining === null) return null;
  if (daysRemaining < 0) return `Expired ${plural(-daysRemaining, 'day')} ago`;
  if (daysRemaining === 0) return 'Expires today';
  return `${plural(daysRemaining, 'day')} left`;
}
