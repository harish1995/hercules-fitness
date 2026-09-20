/**
 * Money (architecture §6.5, D-6). All storage and arithmetic use INTEGER PAISE; floating point
 * rupees never touch a total. Rupees exist only at the UI/CSV boundary via toPaise/formatInr.
 * Phase 2 stores no money except `pendingPaise: 0`, but the utility ships here with its tests so later
 * phases build on a proven implementation.
 */
export type Paise = number & { readonly __paise: unique symbol };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Upper bound (paise) that keeps every sum inside Number.MAX_SAFE_INTEGER by a wide margin: Rs 100 crore. */
export const MAX_PAISE = 1_000_000_000 * 100;

function assertValidPaise(value: number): Paise {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PAISE) {
    throw new MoneyError('Amount is out of range');
  }
  return value as Paise;
}

/** Wrap an already-integer paise value (e.g. read from Firestore), validating it. */
export function paise(value: number): Paise {
  return assertValidPaise(value);
}

const RUPEES_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a rupee amount typed by the user (`"1500"`, `"1,500.50"`, `"0.30"`) or a number into paise.
 * Rejects negatives, more than 2 decimals, NaN/Infinity and empty input.
 */
export function toPaise(rupees: string | number): Paise {
  if (typeof rupees === 'number') {
    if (!Number.isFinite(rupees) || rupees < 0) throw new MoneyError('Enter a valid amount');
    const scaled = rupees * 100;
    const rounded = Math.round(scaled);
    // tolerate binary noise (0.1 + 0.2 = 0.30000000000000004) but not a third decimal (0.125)
    if (Math.abs(scaled - rounded) > 1e-6) throw new MoneyError('Amount cannot have more than 2 decimal places');
    return assertValidPaise(rounded);
  }
  const text = rupees.trim().replace(/,/g, '');
  if (text === '') throw new MoneyError('Enter an amount');
  if (!RUPEES_PATTERN.test(text)) {
    if (/^\d+\.\d{3,}$/.test(text)) throw new MoneyError('Amount cannot have more than 2 decimal places');
    throw new MoneyError('Enter a valid amount');
  }
  const [whole = '0', fraction = ''] = text.split('.');
  return assertValidPaise(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}

/** Rupees as a plain number for display maths only (never store or sum the result). */
export function fromPaise(value: Paise | number): number {
  return value / 100;
}

export function addPaise(a: Paise, b: Paise): Paise {
  return assertValidPaise(a + b);
}

/** a - b. Throws when the result would be negative (money amounts are never negative, D-6). */
export function subPaise(a: Paise, b: Paise): Paise {
  return assertValidPaise(a - b);
}

/** `₹1,500.00` (Indian digit grouping). Built from integers so no rounding is involved. */
export function formatInr(value: Paise | number): string {
  if (!Number.isSafeInteger(value)) throw new MoneyError('Amount is not a whole number of paise');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const rupees = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}₹${new Intl.NumberFormat('en-IN').format(rupees)}.${fraction}`;
}

/**
 * Integer paise as a plain rupee number with exactly 2 decimals (`150000` -> `1500.00`), for CSV cells: no currency symbol and
 * no digit grouping, so a spreadsheet reads it as a number and sums it. Built from integers, so no rounding is involved.
 */
export function formatRupeesPlain(value: Paise | number): string {
  if (!Number.isSafeInteger(value)) throw new MoneyError('Amount is not a whole number of paise');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
