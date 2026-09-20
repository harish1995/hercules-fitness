import { MAX_DURATION_DAYS, MAX_DURATION_MONTHS, type DurationUnit } from '../constants/enums';
import { MAX_PAISE } from './money';

/** Plan business rules shared by the form schema, the service and (mirrored) the Firestore rules. */

export const PLAN_NAME_MAX = 60;
export const PLAN_DESCRIPTION_MAX = 300;

export function maxDuration(unit: DurationUnit): number {
  return unit === 'DAYS' ? MAX_DURATION_DAYS : MAX_DURATION_MONTHS;
}

/** null when valid, else a user-safe message. */
export function planDurationError(value: number, unit: DurationUnit): string | null {
  if (!Number.isInteger(value) || value < 1) return 'Duration must be a whole number of at least 1';
  if (value > maxDuration(unit)) return `Duration cannot be more than ${maxDuration(unit)} ${unit === 'DAYS' ? 'days' : 'months'}`;
  return null;
}

/** null when valid, else a user-safe message. A free plan is not supported (FR-3: price > 0). */
export function planPriceError(pricePaise: number): string | null {
  if (!Number.isSafeInteger(pricePaise) || pricePaise <= 0) return 'Price must be greater than 0';
  if (pricePaise > MAX_PAISE) return 'Price is too large';
  return null;
}
