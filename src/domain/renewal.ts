import { type DurationUnit } from '../constants/enums';
import { addIstDays, addIstMonths, istDayStart } from './dates';

/**
 * Renewal date arithmetic (FR-5, architecture §6.4). Pure, and called INSIDE the assign / renew transactions with the
 * freshly read latest end date, never with values captured when a dialog opened (US-3.6f, US-3.7a).
 * All dates are 00:00 IST calendar days; the end date is INCLUSIVE (D-2).
 */

/**
 * MONTHS: start + N months - 1 day (month-end days clamp: 31/01 + 1 month = 28/02, so 31/01 ends 27/02 - NEW-6).
 * DAYS:   start + N - 1 days (a 1-day plan starts and ends on the same day).
 */
export function computeEndDate(start: Date, durationValue: number, unit: DurationUnit): Date {
  if (!Number.isInteger(durationValue) || durationValue < 1) throw new RangeError('Plan duration must be a positive whole number');
  const s = istDayStart(start);
  return unit === 'MONTHS' ? addIstDays(addIstMonths(s, durationValue), -1) : addIstDays(s, durationValue - 1);
}

/**
 * The start of a renewal:
 *   no membership yet          -> today
 *   latest end >= today        -> latest end + 1 day (still valid, incl. ending today; early renewals STACK)
 *   latest end <  today        -> today (expired; the gap days are not backfilled)
 */
export function computeRenewalStart(latestEndDate: Date | null, today: Date): Date {
  const t = istDayStart(today);
  if (latestEndDate === null) return t;
  const end = istDayStart(latestEndDate);
  return end.getTime() >= t.getTime() ? addIstDays(end, 1) : t;
}

/** "1 month", "12 months", "10 days" */
export function formatPlanDuration(value: number, unit: DurationUnit): string {
  const word = unit === 'MONTHS' ? 'month' : 'day';
  return `${value} ${word}${value === 1 ? '' : 's'}`;
}
