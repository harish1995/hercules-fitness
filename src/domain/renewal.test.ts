import { describe, expect, it } from 'vitest';
import { formatIstDate, fromCivilDate } from './dates';
import { computeEndDate, computeRenewalStart, formatPlanDuration } from './renewal';

/**
 * US-8.1a / US-3.5 / US-3.6: renewal rules and the month-end table of FR-5 (NEW-6). Dates are 00:00 IST calendar days; the end date is
 * INCLUSIVE, so a plan of N months starting on D ends on D + N months - 1 day.
 */
const d = (y: number, m: number, day: number) => fromCivilDate(y, m, day);
const fmt = formatIstDate;

describe('computeEndDate: the FR-5 month arithmetic table', () => {
  it.each([
    [d(2026, 10, 1), 1, 'MONTHS', '31/10/2026'],
    [d(2026, 1, 15), 1, 'MONTHS', '14/02/2026'],
    [d(2026, 1, 31), 1, 'MONTHS', '27/02/2026'],
    [d(2026, 9, 15), 12, 'MONTHS', '14/09/2027'],
    [d(2028, 2, 29), 12, 'MONTHS', '27/02/2029'],
  ] as const)('%s + %d %s -> %s', (start, n, unit, expected) => {
    expect(fmt(computeEndDate(start, n, unit))).toBe(expected);
  });

  it('every start from 28 to 31 January ends on 27/02/2026 (month-end clamping, 28 days), 1 month', () => {
    for (const day of [28, 29, 30, 31]) expect(fmt(computeEndDate(d(2026, 1, day), 1, 'MONTHS'))).toBe('27/02/2026');
  });

  it('leap year: 31/01/2028 + 1 month clamps to 29/02/2028, so the period ends 28/02/2028', () => {
    expect(fmt(computeEndDate(d(2028, 1, 31), 1, 'MONTHS'))).toBe('28/02/2028');
    expect(fmt(computeEndDate(d(2028, 1, 30), 1, 'MONTHS'))).toBe('28/02/2028');
    expect(fmt(computeEndDate(d(2028, 1, 1), 1, 'MONTHS'))).toBe('31/01/2028');
  });

  it('months that are not month ends behave normally, across a year boundary, 30- and 31-day months', () => {
    expect(fmt(computeEndDate(d(2026, 12, 15), 1, 'MONTHS'))).toBe('14/01/2027');
    expect(fmt(computeEndDate(d(2026, 11, 30), 3, 'MONTHS'))).toBe('27/02/2027'); // 30/11 + 3 months = 28/02 (clamped), minus 1 day
    expect(fmt(computeEndDate(d(2026, 3, 31), 1, 'MONTHS'))).toBe('29/04/2026'); // 31/03 + 1 month = 30/04, minus 1 day
    expect(fmt(computeEndDate(d(2026, 1, 1), 12, 'MONTHS'))).toBe('31/12/2026');
  });

  it('day plans: start + N - 1 days, inclusive (a 1-day plan starts and ends the same day)', () => {
    expect(fmt(computeEndDate(d(2026, 9, 19), 1, 'DAYS'))).toBe('19/09/2026');
    expect(fmt(computeEndDate(d(2026, 9, 19), 10, 'DAYS'))).toBe('28/09/2026');
    expect(fmt(computeEndDate(d(2026, 9, 25), 30, 'DAYS'))).toBe('24/10/2026');
    expect(fmt(computeEndDate(d(2028, 2, 20), 10, 'DAYS'))).toBe('29/02/2028');
    expect(fmt(computeEndDate(d(2026, 12, 25), 10, 'DAYS'))).toBe('03/01/2027');
  });

  it('the result is always 00:00 IST, even when the start carries a time of day', () => {
    const noon = new Date(d(2026, 9, 19).getTime() + 12 * 3_600_000);
    expect(computeEndDate(noon, 1, 'MONTHS').toISOString()).toBe(d(2026, 10, 18).toISOString());
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a duration of %s', (value) => {
    expect(() => computeEndDate(d(2026, 9, 1), value, 'DAYS')).toThrow(RangeError);
    expect(() => computeEndDate(d(2026, 9, 1), value, 'MONTHS')).toThrow(RangeError);
  });
});

describe('computeRenewalStart (FR-5, AC-5, AC-6)', () => {
  const today = d(2026, 9, 25);

  it('a first membership starts today', () => {
    expect(fmt(computeRenewalStart(null, today))).toBe('25/09/2026');
  });

  it('AC-5 early renewal: ends 30/09, renewed on 25/09 -> the new period starts 01/10 and (1 month) ends 31/10', () => {
    const start = computeRenewalStart(d(2026, 9, 30), today);
    expect(fmt(start)).toBe('01/10/2026');
    expect(fmt(computeEndDate(start, 1, 'MONTHS'))).toBe('31/10/2026');
  });

  it('AC-6 renew an expired membership: expired 30/09, renewed on 10/10 -> starts today, the gap is not backfilled', () => {
    expect(fmt(computeRenewalStart(d(2026, 9, 30), d(2026, 10, 10)))).toBe('10/10/2026');
  });

  it.each([
    ['renewal on the end date itself (still valid today)', d(2026, 9, 25), '26/09/2026'],
    ['renewal the day AFTER the end date (expired yesterday)', d(2026, 9, 24), '25/09/2026'],
    ['end date tomorrow', d(2026, 9, 26), '27/09/2026'],
    ['end date long ago', d(2020, 1, 1), '25/09/2026'],
  ])('%s', (_label, latestEnd, expected) => {
    expect(fmt(computeRenewalStart(latestEnd, today))).toBe(expected);
  });

  it('repeated early renewals STACK: each starts the day after the previous end', () => {
    let latestEnd: Date | null = d(2026, 9, 30);
    const periods: string[] = [];
    for (let i = 0; i < 3; i++) {
      const start = computeRenewalStart(latestEnd, today);
      latestEnd = computeEndDate(start, 1, 'MONTHS');
      periods.push(`${fmt(start)}-${fmt(latestEnd)}`);
    }
    expect(periods).toEqual(['01/10/2026-31/10/2026', '01/11/2026-30/11/2026', '01/12/2026-31/12/2026']);
  });

  it('a future-dated latest membership is included: the new one starts after it, not today', () => {
    expect(fmt(computeRenewalStart(d(2027, 3, 31), today))).toBe('01/04/2027');
  });

  it('a stale "today" (dialog opened before midnight) is why the transaction recomputes: same end date, later day, different start', () => {
    const end = d(2026, 9, 25);
    expect(fmt(computeRenewalStart(end, d(2026, 9, 25)))).toBe('26/09/2026'); // opened on the end date
    expect(fmt(computeRenewalStart(end, d(2026, 9, 26)))).toBe('26/09/2026'); // confirmed after midnight: expired, restarts today (26)
    expect(fmt(computeRenewalStart(end, d(2026, 9, 27)))).toBe('27/09/2026');
  });

  it('the clock time of "today" is ignored (only its IST day counts)', () => {
    const lateEvening = new Date(d(2026, 9, 25).getTime() + 23 * 3_600_000);
    expect(fmt(computeRenewalStart(d(2026, 9, 30), lateEvening))).toBe('01/10/2026');
  });
});

describe('formatPlanDuration', () => {
  it.each([
    [1, 'MONTHS', '1 month'],
    [12, 'MONTHS', '12 months'],
    [1, 'DAYS', '1 day'],
    [10, 'DAYS', '10 days'],
  ] as const)('%d %s -> %s', (v, unit, text) => {
    expect(formatPlanDuration(v, unit)).toBe(text);
  });
});
