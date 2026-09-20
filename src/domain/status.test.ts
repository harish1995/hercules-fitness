import { afterEach, describe, expect, it } from 'vitest';
import { addIstDays, fromCivilDate } from './dates';
import { calculateMembershipStatus, describeDaysRemaining, EXPIRING_SOON_MAX_DAYS, InvalidPeriodError } from './status';

/**
 * US-8.1a / US-3.4: the membership status boundary matrix (D-1..D-5). "Today" is the IST calendar day of the injected clock, so the
 * whole matrix is deterministic and independent of the machine's time zone. IST = UTC+05:30, so 00:00 IST is 18:30 UTC the day before.
 */
const at = (iso: string) => () => new Date(iso);
const TODAY = fromCivilDate(2026, 9, 19);
const NOON_IST = at('2026-09-19T06:30:00Z'); // 12:00 IST on 19/09/2026
const end = (offsetDays: number) => addIstDays(TODAY, offsetDays);
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('D-4 boundary table (today = 19/09/2026 IST)', () => {
  it.each([
    ['18/09/2026 (yesterday)', -1, 'EXPIRED'],
    ['19/09/2026 (today)', 0, 'EXPIRING_SOON'],
    ['20/09/2026', 1, 'EXPIRING_SOON'],
    ['26/09/2026 (exactly 7 days out)', 7, 'EXPIRING_SOON'],
    ['27/09/2026 (8 days out)', 8, 'ACTIVE'],
  ] as const)('end date %s -> daysRemaining %d -> %s', (_label, offset, status) => {
    const r = calculateMembershipStatus(end(-30), end(offset), { clock: NOON_IST });
    expect(r.daysRemaining).toBe(offset);
    expect(r.status).toBe(status);
  });

  it('the window constant is 7 and both edges are inclusive', () => {
    expect(EXPIRING_SOON_MAX_DAYS).toBe(7);
    expect(calculateMembershipStatus(null, end(EXPIRING_SOON_MAX_DAYS), { clock: NOON_IST }).status).toBe('EXPIRING_SOON');
    expect(calculateMembershipStatus(null, end(EXPIRING_SOON_MAX_DAYS + 1), { clock: NOON_IST }).status).toBe('ACTIVE');
    expect(calculateMembershipStatus(null, end(0), { clock: NOON_IST }).status).toBe('EXPIRING_SOON');
    expect(calculateMembershipStatus(null, end(-1), { clock: NOON_IST }).status).toBe('EXPIRED');
  });

  it('far past and far future', () => {
    expect(calculateMembershipStatus(null, end(-400), { clock: NOON_IST })).toMatchObject({ status: 'EXPIRED', daysRemaining: -400 });
    expect(calculateMembershipStatus(null, end(400), { clock: NOON_IST })).toMatchObject({ status: 'ACTIVE', daysRemaining: 400 });
  });

  it('the end date is INCLUSIVE (D-2): valid for the whole of the end day, expired the next IST midnight', () => {
    const endDay = end(0);
    // 23:59:59.999 IST on the end date = 18:29:59.999 UTC
    expect(calculateMembershipStatus(null, endDay, { clock: at('2026-09-19T18:29:59.999Z') })).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 0 });
    // 00:00:00.000 IST the next day = 18:30:00.000 UTC
    expect(calculateMembershipStatus(null, endDay, { clock: at('2026-09-19T18:30:00.000Z') })).toMatchObject({ status: 'EXPIRED', daysRemaining: -1 });
  });
});

describe('IST day boundaries and device time zones (D-1)', () => {
  it.each([
    ['00:00:00 IST', '2026-09-18T18:30:00.000Z'],
    ['00:00:01 IST', '2026-09-18T18:30:01.000Z'],
    ['12:00 IST', '2026-09-19T06:30:00.000Z'],
    ['23:59:59 IST', '2026-09-19T18:29:59.000Z'],
  ])('%s is still 19/09 in IST: an end date of 26/09 has exactly 7 days left', (_label, iso) => {
    expect(calculateMembershipStatus(null, end(7), { clock: at(iso) })).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 7 });
  });

  it('18:29:59 UTC on 18/09 is still 18/09 in IST (23:59:59 IST); 18:30:00 UTC is 19/09 00:00 IST', () => {
    expect(calculateMembershipStatus(null, end(7), { clock: at('2026-09-18T18:29:59.000Z') }).daysRemaining).toBe(8);
    expect(calculateMembershipStatus(null, end(7), { clock: at('2026-09-18T18:30:00.000Z') }).daysRemaining).toBe(7);
  });

  it('the status flips exactly at IST midnight (a UTC-day calculation would flip 5.5 hours off)', () => {
    // end date 27/09: on 19/09 (up to 23:59:59 IST = 18:29:59 UTC) it is 8 days out = ACTIVE; from 20/09 00:00 IST (18:30:00 UTC) it is 7 = EXPIRING_SOON
    expect(calculateMembershipStatus(null, end(8), { clock: at('2026-09-19T18:29:59Z') })).toMatchObject({ status: 'ACTIVE', daysRemaining: 8 });
    expect(calculateMembershipStatus(null, end(8), { clock: at('2026-09-19T18:30:00Z') })).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 7 });
    // and the calendar day of the device in UTC is one day behind IST between 18:30 and 24:00 UTC
    expect(calculateMembershipStatus(null, end(0), { clock: at('2026-09-19T20:00:00Z') }).status).toBe('EXPIRED'); // 01:30 IST on 20/09
  });

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    'gives the same answer when the device time zone is %s',
    (tz) => {
      process.env.TZ = tz;
      const r = calculateMembershipStatus(end(-30), end(7), { clock: at('2026-09-18T18:30:00Z') });
      expect(r).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 7 });
      expect(calculateMembershipStatus(null, end(0), { clock: at('2026-09-19T18:30:00Z') }).status).toBe('EXPIRED');
    },
  );
});

describe('SUSPENDED wins (D-4 order 1, AC-4)', () => {
  it.each([-30, -1, 0, 7, 8, 200])('suspended with %d days remaining is SUSPENDED and still reports the days', (offset) => {
    expect(calculateMembershipStatus(end(-60), end(offset), { suspended: true, clock: NOON_IST })).toEqual({
      status: 'SUSPENDED',
      daysRemaining: offset,
      startsInFuture: false,
    });
  });

  it('a stored suspended flag on a member with no end date is SUSPENDED; without the flag it is NO_MEMBERSHIP', () => {
    expect(calculateMembershipStatus(null, null, { suspended: true }).status).toBe('SUSPENDED');
    expect(calculateMembershipStatus(null, null)).toEqual({ status: 'NO_MEMBERSHIP', daysRemaining: null, startsInFuture: false });
  });
});

describe('invalid input is rejected, never silently computed (US-3.4e)', () => {
  it('an end date before the start date throws InvalidPeriodError, even when suspended', () => {
    expect(() => calculateMembershipStatus(end(5), end(4), { clock: NOON_IST })).toThrow(InvalidPeriodError);
    expect(() => calculateMembershipStatus(end(5), end(4), { suspended: true, clock: NOON_IST })).toThrow(InvalidPeriodError);
  });

  it('a one-day plan (end == start) is valid', () => {
    expect(calculateMembershipStatus(end(3), end(3), { clock: NOON_IST })).toMatchObject({ status: 'EXPIRING_SOON', daysRemaining: 3 });
  });

  it('the comparison ignores time of day: a start later in the same IST day as the end is not "before"', () => {
    const start = new Date(end(3).getTime() + 10 * 3_600_000);
    expect(() => calculateMembershipStatus(start, end(3), { clock: NOON_IST })).not.toThrow();
  });
});

describe('startsInFuture (NEW-5) is a label only, never a status', () => {
  it('a membership that has not started yet keeps its date-derived status', () => {
    const r = calculateMembershipStatus(end(5), end(35), { clock: NOON_IST });
    expect(r).toEqual({ status: 'ACTIVE', daysRemaining: 35, startsInFuture: true });
    expect(calculateMembershipStatus(end(0), end(30), { clock: NOON_IST }).startsInFuture).toBe(false); // starts today
    expect(calculateMembershipStatus(end(-1), end(30), { clock: NOON_IST }).startsInFuture).toBe(false);
  });
});

describe('describeDaysRemaining (US-3.13a)', () => {
  it.each([
    [null, null],
    [0, 'Expires today'],
    [1, '1 day left'],
    [12, '12 days left'],
    [-1, 'Expired 1 day ago'],
    [-30, 'Expired 30 days ago'],
  ] as const)('%s -> %s', (days, text) => {
    expect(describeDaysRemaining(days)).toBe(text);
  });
});
