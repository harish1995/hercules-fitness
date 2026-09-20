import { describe, expect, it } from 'vitest';
import { type AttendanceRecord } from '../types/attendance';
import { attendanceDocId, checkOutLabel, describeCheckIn, evaluateCheckIn, isCurrentlyCheckedIn, isToday } from './attendance';
import { addIstDays, fromCivilDate, istDayKey } from './dates';

/**
 * US-8.1a / US-5: the attendance IST day boundary, "currently checked in", and the NEW-12 check-in rule. One record per member per IST
 * day is structural (the document id carries the IST day), so the day boundary is what decides whether a second check-in is a duplicate.
 */
const at = (iso: string) => new Date(iso);
const clock = (iso: string) => () => at(iso);
const TODAY = fromCivilDate(2026, 9, 19);

describe('attendanceDocId: {memberDocId}_{YYYYMMDD} of the IST day', () => {
  it('23:59:59 IST and 00:00:00 IST are different days (18:29:59 UTC vs 18:30:00 UTC)', () => {
    expect(attendanceDocId('m1', at('2026-09-19T18:29:59Z'))).toBe('m1_20260919');
    expect(attendanceDocId('m1', at('2026-09-19T18:30:00Z'))).toBe('m1_20260920');
  });

  it('00:10 IST belongs to the NEW IST day even though it is still the previous day in UTC and in America/Los_Angeles', () => {
    expect(attendanceDocId('m1', at('2026-09-19T18:40:00Z'))).toBe('m1_20260920');
    expect(istDayKey(at('2026-09-19T18:40:00Z'))).toBe('20260920');
  });

  it('is stable for the whole IST day and changes at month and year ends', () => {
    expect(attendanceDocId('m1', at('2026-09-18T18:30:00Z'))).toBe('m1_20260919');
    expect(attendanceDocId('m1', at('2026-09-19T06:00:00Z'))).toBe('m1_20260919');
    expect(attendanceDocId('m1', at('2026-09-30T18:30:00Z'))).toBe('m1_20261001');
    expect(attendanceDocId('m1', at('2026-12-31T18:29:59Z'))).toBe('m1_20261231');
    expect(attendanceDocId('m1', at('2026-12-31T18:30:00Z'))).toBe('m1_20270101');
    expect(attendanceDocId('m1', at('2028-02-28T18:30:00Z'))).toBe('m1_20280229'); // leap day
  });

  it('two members on one day and one member on two days never collide', () => {
    const ids = new Set([
      attendanceDocId('a', at('2026-09-19T06:00:00Z')),
      attendanceDocId('b', at('2026-09-19T06:00:00Z')),
      attendanceDocId('a', at('2026-09-20T06:00:00Z')),
    ]);
    expect(ids.size).toBe(3);
  });
});

const record = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 'm1_20260919',
  memberDocId: 'm1',
  memberId: 'GYM-2026-0001',
  memberName: 'Rahul Sharma',
  date: TODAY,
  dateKey: '20260919',
  status: 'PRESENT',
  checkInAt: at('2026-09-19T03:30:00Z'),
  checkOutAt: null,
  checkedOut: false,
  createdAt: at('2026-09-19T03:30:00Z'),
  createdBy: 'staff',
  updatedAt: at('2026-09-19T03:30:00Z'),
  updatedBy: 'staff',
  ...over,
} as AttendanceRecord);

describe('isToday / isCurrentlyCheckedIn: the day boundary decides', () => {
  const noon = at('2026-09-19T06:30:00Z');

  it('a record dated today is today for the whole IST day, and not from 00:00:00 IST the next day', () => {
    expect(isToday(record(), at('2026-09-18T18:30:00Z'))).toBe(true); // 00:00 IST
    expect(isToday(record(), at('2026-09-19T18:29:59Z'))).toBe(true); // 23:59:59 IST
    expect(isToday(record(), at('2026-09-19T18:30:00Z'))).toBe(false); // 00:00 IST next day
    expect(isToday(record(), at('2026-09-18T18:29:59Z'))).toBe(false); // 23:59:59 IST the day before
  });

  it('currently checked in = today, PRESENT, checked in, not checked out', () => {
    expect(isCurrentlyCheckedIn(record(), noon)).toBe(true);
    expect(isCurrentlyCheckedIn(record({ checkedOut: true, checkOutAt: at('2026-09-19T05:00:00Z') }), noon)).toBe(false);
    expect(isCurrentlyCheckedIn(record({ status: 'ABSENT', checkInAt: null }), noon)).toBe(false);
  });

  it('a forgotten check-out on an earlier day is NEVER currently in: the count resets at 00:00 IST', () => {
    const yesterday = record({ date: addIstDays(TODAY, -1), dateKey: '20260918' });
    expect(isCurrentlyCheckedIn(yesterday, noon)).toBe(false);
    // 18/09's own record: still "in" at 23:59:59 IST on 18/09, no longer one second later (00:00:00 IST on 19/09)
    expect(isCurrentlyCheckedIn(yesterday, at('2026-09-18T18:29:59Z'))).toBe(true);
    expect(isCurrentlyCheckedIn(yesterday, at('2026-09-18T18:30:00Z'))).toBe(false);
    // and today's record resets the same way at the next midnight
    expect(isCurrentlyCheckedIn(record(), at('2026-09-19T18:29:59Z'))).toBe(true);
    expect(isCurrentlyCheckedIn(record(), at('2026-09-19T18:30:00Z'))).toBe(false);
  });
});

describe('checkOutLabel: never a blank cell', () => {
  const noon = at('2026-09-19T06:30:00Z');
  it.each([
    ['still in today', record(), 'Still in'],
    ['no check-out on an earlier day', record({ date: addIstDays(TODAY, -1) }), 'Not recorded'],
    ['checked out', record({ checkedOut: true, checkOutAt: at('2026-09-19T05:30:00Z') }), '11:00'],
    ['absent', record({ status: 'ABSENT', checkInAt: null }), '—'],
  ])('%s -> %s', (_label, r, expected) => {
    expect(checkOutLabel(r, noon)).toBe(expected);
  });

  it('describeCheckIn', () => {
    expect(describeCheckIn({ checkInAt: at('2026-09-19T03:35:00Z') })).toBe('at 09:05');
    expect(describeCheckIn({ checkInAt: null })).toBe('');
  });
});

describe('evaluateCheckIn (NEW-12): suspended blocked, expired / no membership need confirmation', () => {
  const noon = clock('2026-09-19T06:30:00Z');
  const member = (endOffset: number | null, suspended = false) => ({
    suspended,
    membership: {
      membershipId: endOffset === null ? null : 'ms1',
      planId: null,
      planName: null,
      startDate: endOffset === null ? null : addIstDays(TODAY, endOffset - 29),
      endDate: endOffset === null ? null : addIstDays(TODAY, endOffset),
      amountPaise: null,
    },
  });

  it.each([
    ['ACTIVE (8 days)', member(8), 'ALLOW', 'ACTIVE'],
    ['EXPIRING_SOON (exactly 7 days)', member(7), 'ALLOW', 'EXPIRING_SOON'],
    ['EXPIRING_SOON (ends today)', member(0), 'ALLOW', 'EXPIRING_SOON'],
    ['EXPIRED (yesterday)', member(-1), 'CONFIRM', 'EXPIRED'],
    ['NO membership', member(null), 'CONFIRM', 'NO_MEMBERSHIP'],
    ['SUSPENDED (even with 30 days left)', member(30, true), 'BLOCK', 'SUSPENDED'],
    ['SUSPENDED and expired', member(-10, true), 'BLOCK', 'SUSPENDED'],
  ] as const)('%s -> %s', (_label, m, action, status) => {
    const r = evaluateCheckIn(m, noon);
    expect(r.action).toBe(action);
    expect(r.status).toBe(status);
  });

  it('messages: none for ACTIVE, days left for EXPIRING_SOON, an expiry sentence for EXPIRED', () => {
    expect(evaluateCheckIn(member(20), noon).message).toBeNull();
    expect(evaluateCheckIn(member(3), noon).message).toBe('Membership expiring soon: 3 days left.');
    expect(evaluateCheckIn(member(-1), noon).message).toBe('The membership has expired on 18/09/2026 (expired 1 day ago).');
    expect(evaluateCheckIn(member(null), noon).message).toBe('This member has no membership.');
  });

  it('the decision follows the IST day: the same member is ALLOW at 23:59:59 IST and CONFIRM at 00:00:00 IST after the end date', () => {
    const ends = member(0); // ends 19/09
    expect(evaluateCheckIn(ends, clock('2026-09-19T18:29:59Z')).action).toBe('ALLOW');
    expect(evaluateCheckIn(ends, clock('2026-09-19T18:30:00Z')).action).toBe('CONFIRM');
  });

  it('corrupt dates (end before start) cannot be trusted: CONFIRM (BLOCK when suspended), never a crash', () => {
    const bad = { suspended: false, membership: { ...member(5).membership, startDate: addIstDays(TODAY, 10) } };
    expect(evaluateCheckIn(bad, noon)).toMatchObject({ action: 'CONFIRM', status: 'NO_MEMBERSHIP' });
    expect(evaluateCheckIn({ ...bad, suspended: true }, noon)).toMatchObject({ action: 'BLOCK', status: 'SUSPENDED' });
  });
});
