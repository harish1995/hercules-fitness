import { useEffect, useState } from 'react';
import { measureClockSkewMs } from '../services/clockSkewService';

/** Re-measure this often while the app stays open (a device clock can be changed mid-session) and when the tab becomes visible again. */
export const CLOCK_RECHECK_MS = 30 * 60_000;

/**
 * device - server clock difference in ms (null = unknown). Measured once when the signed-in shell mounts, then every 30 minutes and
 * when the tab regains focus after that long. A failed measurement keeps the last known value.
 */
export function useClockSkew(): number | null {
  const [skew, setSkew] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastMeasuredAt = Date.now();
    const measure = () => {
      lastMeasuredAt = Date.now();
      void measureClockSkewMs().then((ms) => {
        if (!cancelled && ms !== null) setSkew(ms);
      });
    };
    measure();
    const timer = window.setInterval(measure, CLOCK_RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMeasuredAt > CLOCK_RECHECK_MS) measure();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return skew;
}
