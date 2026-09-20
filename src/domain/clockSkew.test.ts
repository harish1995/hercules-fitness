import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_THRESHOLD_MS, clockSkewMs, clockSkewWarning, describeSkewSize, isClockSkewed } from './clockSkew';

const MIN = 60_000;

describe('clock skew (R-3): a device clock more than 5 minutes off the server is flagged', () => {
  it('skew is device minus server: positive when the device is ahead', () => {
    const server = new Date('2026-09-20T10:00:00Z');
    expect(clockSkewMs(server, new Date('2026-09-20T10:07:00Z'))).toBe(7 * MIN);
    expect(clockSkewMs(server, new Date('2026-09-20T09:55:00Z'))).toBe(-5 * MIN);
    expect(clockSkewMs(server, server)).toBe(0);
  });

  it('threshold: exactly 5 minutes is fine, one millisecond more (either direction) warns', () => {
    expect(CLOCK_SKEW_THRESHOLD_MS).toBe(5 * MIN);
    expect(isClockSkewed(5 * MIN)).toBe(false);
    expect(isClockSkewed(-5 * MIN)).toBe(false);
    expect(isClockSkewed(5 * MIN + 1)).toBe(true);
    expect(isClockSkewed(-(5 * MIN + 1))).toBe(true);
    expect(isClockSkewed(0)).toBe(false);
  });

  it('an unknown or non-finite measurement never warns', () => {
    expect(isClockSkewed(null)).toBe(false);
    expect(isClockSkewed(Number.NaN)).toBe(false);
    expect(isClockSkewed(Number.POSITIVE_INFINITY)).toBe(false);
    expect(clockSkewWarning(null)).toBeNull();
  });

  it.each([
    [6 * MIN, 'about 6 minutes'],
    [-6 * MIN, 'about 6 minutes'],
    [119 * MIN, 'about 119 minutes'],
    [120 * MIN, 'about 2 hours'],
    [-3 * 60 * MIN, 'about 3 hours'],
    [47 * 60 * MIN, 'about 47 hours'],
    [48 * 60 * MIN, 'about 2 days'],
    [365 * 24 * 60 * MIN, 'about 365 days'],
  ])('sizes %d ms as "%s"', (ms, text) => {
    expect(describeSkewSize(ms)).toBe(text);
  });

  it('the warning says whether the device is ahead or behind and that dates and statuses may be wrong', () => {
    expect(clockSkewWarning(7 * MIN)).toMatch(/clock is about 7 minutes ahead\. Dates and statuses may be incorrect/);
    expect(clockSkewWarning(-2 * 60 * MIN)).toMatch(/clock is about 2 hours behind/);
    expect(clockSkewWarning(5 * MIN)).toBeNull();
  });
});
