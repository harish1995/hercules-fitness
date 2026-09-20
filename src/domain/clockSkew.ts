/**
 * Client-clock mitigation (architecture 6.6, R-3). Every status, "days remaining" and "today" on screen uses the DEVICE clock, while the
 * rules bound every write by the SERVER clock (`request.time`), so a device with a wrong clock shows wrong statuses without any error.
 * Pure and Firebase-free: the service supplies a server-issued time (`clockSkewService`), this module decides whether it is a problem.
 */

/** Skew ABOVE this (either direction) raises the persistent banner. Exactly this much does not. */
export const CLOCK_SKEW_THRESHOLD_MS = 5 * 60_000;

/** device time minus server time: positive = the device clock is AHEAD of the server. */
export function clockSkewMs(serverTime: Date, deviceNow: Date): number {
  return deviceNow.getTime() - serverTime.getTime();
}

export function isClockSkewed(skewMs: number | null): boolean {
  return skewMs !== null && Number.isFinite(skewMs) && Math.abs(skewMs) > CLOCK_SKEW_THRESHOLD_MS;
}

/** "about 7 minutes", "about 3 hours", "about 2 days": rounded, never more precise than the measurement (1 s token resolution + latency). */
export function describeSkewSize(skewMs: number): string {
  const minutes = Math.round(Math.abs(skewMs) / 60_000);
  if (minutes < 120) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hours`;
  const days = Math.round(hours / 24);
  return `about ${days} days`;
}

/** The banner text, or null when the clock is fine (or unknown). */
export function clockSkewWarning(skewMs: number | null): string | null {
  if (skewMs === null || !isClockSkewed(skewMs)) return null;
  const direction = skewMs > 0 ? 'ahead' : 'behind';
  return `This device's clock is ${describeSkewSize(skewMs)} ${direction}. Dates and statuses may be incorrect. Set the date and time to automatic and reload the page.`;
}
