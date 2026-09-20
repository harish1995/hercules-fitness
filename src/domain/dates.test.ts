import { afterEach, describe, expect, it } from 'vitest';
import {
  addIstDays,
  ageOnIstDate,
  diffIstDays,
  formatIstDate,
  formatIstDateTime,
  fromCivilDate,
  isUnder18,
  istDayKey,
  istDayStart,
  istMonthRange,
  istYear,
  lastIstMonths,
  parseDayInput,
  todayIstStart,
  toCivilDate,
  toDayInputValue,
} from './dates';

/** IST = UTC+05:30. 00:00 IST on day D is 18:30 UTC on D-1. */
const at = (iso: string) => () => new Date(iso);
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('IST day anchoring (D-1)', () => {
  it('fromCivilDate pins a calendar day to 00:00 IST (18:30 UTC the previous day)', () => {
    expect(fromCivilDate(2026, 9, 19).toISOString()).toBe('2026-09-18T18:30:00.000Z');
    expect(fromCivilDate(2026, 1, 1).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => fromCivilDate(2026, 2, 30)).toThrow(RangeError);
    expect(() => fromCivilDate(2026, 13, 1)).toThrow(RangeError);
    expect(() => fromCivilDate(2026, 4, 31)).toThrow(RangeError);
  });

  it('accepts 29 Feb only in leap years', () => {
    expect(fromCivilDate(2028, 2, 29).toISOString()).toBe('2028-02-28T18:30:00.000Z');
    expect(() => fromCivilDate(2026, 2, 29)).toThrow(RangeError);
  });

  it('istDayStart maps any instant of an IST day to that day\'s 00:00 IST', () => {
    const start = '2026-09-18T18:30:00.000Z'; // 19/09 00:00 IST
    expect(istDayStart(new Date('2026-09-18T18:30:00.000Z')).toISOString()).toBe(start);
    expect(istDayStart(new Date('2026-09-19T18:29:59.999Z')).toISOString()).toBe(start); // 23:59:59.999 IST
    expect(istDayStart(new Date('2026-09-19T18:30:00.000Z')).toISOString()).toBe('2026-09-19T18:30:00.000Z'); // 20/09
  });

  it('is independent of the device time zone (UTC and America/Los_Angeles give IST results)', () => {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      expect(istDayStart(new Date('2026-09-19T00:00:00Z')).toISOString()).toBe('2026-09-18T18:30:00.000Z');
      expect(toDayInputValue(new Date('2026-09-18T18:30:00.000Z'))).toBe('2026-09-19');
      expect(formatIstDate(new Date('2026-09-18T18:30:00.000Z'))).toBe('19/09/2026');
      expect(parseDayInput('2026-09-19')?.toISOString()).toBe('2026-09-18T18:30:00.000Z');
    }
  });

  it('todayIstStart flips at 00:00:00 IST, not at UTC midnight', () => {
    expect(todayIstStart(at('2026-09-19T18:29:59.999Z')).toISOString()).toBe('2026-09-18T18:30:00.000Z'); // 23:59:59 IST on 19/09
    expect(todayIstStart(at('2026-09-19T18:30:00.000Z')).toISOString()).toBe('2026-09-19T18:30:00.000Z'); // 00:00:00 IST on 20/09
  });
});

describe('parseDayInput / toDayInputValue', () => {
  it('round-trips a valid YYYY-MM-DD', () => {
    expect(toDayInputValue(parseDayInput('2000-02-29') as Date)).toBe('2000-02-29');
  });

  it.each(['', '2026-9-19', '19/09/2026', '2026-02-30', '2026-13-01', '1899-12-31', 'abc', '2026-09-19T00:00'])(
    'returns null for %j',
    (value) => {
      expect(parseDayInput(value)).toBeNull();
    },
  );
});

describe('formatting', () => {
  it('formats DD/MM/YYYY and DD/MM/YYYY HH:mm in IST', () => {
    const d = new Date('2026-09-19T18:35:00.000Z'); // 20/09 00:05 IST
    expect(formatIstDate(d)).toBe('20/09/2026');
    expect(formatIstDateTime(d)).toBe('20/09/2026 00:05');
    expect(istDayKey(d)).toBe('20260920');
  });

  it('toCivilDate reads the IST calendar date', () => {
    expect(toCivilDate(new Date('2026-12-31T18:30:00.000Z'))).toEqual({ year: 2027, month: 1, day: 1 });
  });
});

describe('istYear (US-2.2c)', () => {
  it('is 2027 from 00:00 IST on 01/01/2027 even though the UTC year is still 2026', () => {
    expect(istYear(at('2026-12-31T18:29:59.999Z'))).toBe(2026);
    expect(istYear(at('2026-12-31T18:30:00.000Z'))).toBe(2027);
  });

  it('ignores the device time zone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(istYear(at('2026-12-31T18:30:00.000Z'))).toBe(2027);
  });
});

describe('diffIstDays / addIstDays', () => {
  it('counts calendar days, ignoring the time of day', () => {
    const d = (iso: string) => new Date(iso);
    expect(diffIstDays(d('2026-09-19T00:30:00+05:30'), d('2026-09-19T23:59:00+05:30'))).toBe(0);
    expect(diffIstDays(d('2026-09-19T23:59:59+05:30'), d('2026-09-20T00:00:00+05:30'))).toBe(1);
    expect(diffIstDays(fromCivilDate(2026, 9, 26), fromCivilDate(2026, 9, 19))).toBe(-7);
    expect(diffIstDays(fromCivilDate(2026, 2, 27), fromCivilDate(2026, 3, 1))).toBe(2);
  });

  it('addIstDays lands on 00:00 IST of the target day, across month and year ends', () => {
    expect(addIstDays(fromCivilDate(2026, 9, 30), 1).toISOString()).toBe(fromCivilDate(2026, 10, 1).toISOString());
    expect(addIstDays(fromCivilDate(2026, 12, 31), 1).toISOString()).toBe(fromCivilDate(2027, 1, 1).toISOString());
    expect(addIstDays(fromCivilDate(2026, 3, 1), -1).toISOString()).toBe(fromCivilDate(2026, 2, 28).toISOString());
  });
});

describe('istMonthRange (US-2.12c)', () => {
  it('is [1st 00:00 IST, next 1st 00:00 IST)', () => {
    const { start, endExclusive } = istMonthRange(2026, 9);
    expect(start.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('rolls over the year for December', () => {
    expect(istMonthRange(2026, 12).endExclusive.toISOString()).toBe(fromCivilDate(2027, 1, 1).toISOString());
  });

  it('a member who joined on the 1st (stored 00:00 IST) counts in the NEW month, not the previous one', () => {
    const joined = fromCivilDate(2026, 9, 1);
    const sep = istMonthRange(2026, 9);
    const aug = istMonthRange(2026, 8);
    expect(joined >= sep.start && joined < sep.endExclusive).toBe(true);
    expect(joined >= aug.start && joined < aug.endExclusive).toBe(false);
    // and the last day of the previous month is the previous month's
    const lastOfAug = fromCivilDate(2026, 8, 31);
    expect(lastOfAug >= aug.start && lastOfAug < aug.endExclusive).toBe(true);
  });

  it('rejects an invalid month', () => {
    expect(() => istMonthRange(2026, 13)).toThrow(RangeError);
  });
});

describe('lastIstMonths', () => {
  it('returns 12 months oldest first ending with the current IST month', () => {
    const months = lastIstMonths(12, at('2026-09-19T10:00:00Z'));
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 10, label: 'Oct 2025' });
    expect(months[11]).toEqual({ year: 2026, month: 9, label: 'Sep 2026' });
  });

  it('uses the IST month at a UTC month boundary', () => {
    // 30/09 20:00 UTC = 01/10 01:30 IST
    const months = lastIstMonths(2, at('2026-09-30T20:00:00Z'));
    expect(months.map((m) => m.label)).toEqual(['Sep 2026', 'Oct 2026']);
  });
});

describe('age and under-18 (US-2.7)', () => {
  const today = fromCivilDate(2026, 9, 19);

  it('counts completed years on IST calendar dates', () => {
    expect(ageOnIstDate(fromCivilDate(2008, 9, 19), today)).toBe(18); // 18th birthday today
    expect(ageOnIstDate(fromCivilDate(2008, 9, 20), today)).toBe(17); // turns 18 tomorrow
    expect(ageOnIstDate(fromCivilDate(2000, 2, 29), fromCivilDate(2026, 2, 28))).toBe(25);
    expect(ageOnIstDate(fromCivilDate(2000, 2, 29), fromCivilDate(2026, 3, 1))).toBe(26);
  });

  it('isUnder18 flips at 00:00 IST on the 18th birthday', () => {
    const dob = fromCivilDate(2008, 9, 20);
    expect(isUnder18(dob, at('2026-09-19T18:29:59.999Z'))).toBe(true); // 23:59:59 IST on 19/09
    expect(isUnder18(dob, at('2026-09-19T18:30:00.000Z'))).toBe(false); // 00:00 IST on 20/09
  });
});
