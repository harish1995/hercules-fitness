import { describe, expect, it } from 'vitest';
import { counterDocId, formatMemberId, MEMBER_ID_PATTERN, nextSeq } from './memberId';

describe('formatMemberId (US-2.2)', () => {
  it('zero-pads to 4 digits', () => {
    expect(formatMemberId(2026, 1)).toBe('GYM-2026-0001');
    expect(formatMemberId(2026, 8)).toBe('GYM-2026-0008');
    expect(formatMemberId(2026, 9999)).toBe('GYM-2026-9999');
  });

  it('grows to 5 digits after 9999 without error (US-2.2d)', () => {
    expect(formatMemberId(2026, 10000)).toBe('GYM-2026-10000');
    expect(formatMemberId(2026, 123456)).toBe('GYM-2026-123456');
  });

  it('rejects invalid input', () => {
    expect(() => formatMemberId(2026, 0)).toThrow(RangeError);
    expect(() => formatMemberId(2026, 1.5)).toThrow(RangeError);
    expect(() => formatMemberId(26, 1)).toThrow(RangeError);
  });

  it('every generated ID matches the shared pattern', () => {
    for (const seq of [1, 9, 10, 99, 100, 9999, 10000]) {
      expect(MEMBER_ID_PATTERN.test(formatMemberId(2026, seq))).toBe(true);
    }
    expect(MEMBER_ID_PATTERN.test('GYM-2026-1')).toBe(false);
  });
});

describe('nextSeq (US-2.2a/e)', () => {
  it('starts at 1 when the year counter does not exist yet', () => {
    expect(nextSeq(undefined)).toBe(1);
    expect(nextSeq(null)).toBe(1);
  });

  it('is lastSeq + 1', () => {
    expect(nextSeq(7)).toBe(8);
    expect(nextSeq(9999)).toBe(10000);
  });

  it('refuses a corrupt counter rather than guessing', () => {
    expect(() => nextSeq('7')).toThrow(RangeError);
    expect(() => nextSeq(-1)).toThrow(RangeError);
    expect(() => nextSeq(1.5)).toThrow(RangeError);
  });

  it('counter doc id is per year', () => {
    expect(counterDocId(2026)).toBe('memberId-2026');
  });
});
