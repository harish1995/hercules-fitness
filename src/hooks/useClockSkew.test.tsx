import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK_RECHECK_MS, useClockSkew } from './useClockSkew';

const measure = vi.hoisted(() => vi.fn<() => Promise<number | null>>());
vi.mock('../services/clockSkewService', () => ({ measureClockSkewMs: measure }));

beforeEach(() => {
  vi.useFakeTimers();
  measure.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useClockSkew', () => {
  it('measures once on mount and returns the value', async () => {
    measure.mockResolvedValue(7 * 60_000);
    const { result } = renderHook(() => useClockSkew());
    expect(result.current).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(7 * 60_000);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('re-measures every 30 minutes, so a clock changed mid-session is caught', async () => {
    measure.mockResolvedValueOnce(0).mockResolvedValueOnce(3 * 60 * 60_000);
    const { result } = renderHook(() => useClockSkew());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOCK_RECHECK_MS);
    });
    expect(measure).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(3 * 60 * 60_000);
  });

  it('a failed measurement (null) keeps the last known value and never raises a false warning', async () => {
    measure.mockResolvedValueOnce(9 * 60_000).mockResolvedValue(null);
    const { result } = renderHook(() => useClockSkew());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOCK_RECHECK_MS);
    });
    expect(result.current).toBe(9 * 60_000);
  });

  it('stops measuring after unmount', async () => {
    measure.mockResolvedValue(0);
    const { unmount } = renderHook(() => useClockSkew());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await vi.advanceTimersByTimeAsync(CLOCK_RECHECK_MS * 3);
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
