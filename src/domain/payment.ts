import { isPaymentMethod } from '../constants/enums';
import { type PaymentDetails } from '../types/payment';
import { istDayStart } from './dates';
import { addPaise, formatInr, MAX_PAISE, paise, subPaise } from './money';

/**
 * Payment business rules (FR-6, D-7, NEW-9), pure and Firebase-free. All money is INTEGER PAISE. The services run the same
 * checks INSIDE the transaction, the forms run them for instant feedback, and the Firestore rules mirror the shape and the
 * balance invariant, so there is one definition of "a valid payment".
 */

export const PAYMENT_REFERENCE_MAX = 100;
export const PAYMENT_NOTES_MAX = 500;
export const VOID_REASON_MAX = 200;

/** UNPAID (paid = 0), PARTIAL (0 < paid < total), PAID (paid = total): derived, never stored (D-7). */
export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PAID';

export function paymentState(totalPaise: number, paidPaise: number): PaymentState {
  if (paidPaise <= 0) return 'UNPAID';
  return paidPaise >= totalPaise ? 'PAID' : 'PARTIAL';
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = { UNPAID: 'Unpaid', PARTIAL: 'Partial', PAID: 'Paid' };

/** A membership's stored money triple. `unpaid` is the index-friendly flag (`outstandingPaise > 0`). */
export interface MembershipBalance {
  amountPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  unpaid: boolean;
}

/** outstanding = amount - paid. Throws (MoneyError) when paid is negative or exceeds the amount: never a negative balance. */
export function balanceOf(amountPaise: number, paidPaise: number): MembershipBalance {
  const outstanding = subPaise(paise(amountPaise), paise(paidPaise));
  return { amountPaise, paidPaise, outstandingPaise: outstanding, unpaid: outstanding > 0 };
}

/** The balance after a payment of `amountPaise` is recorded. Throws when it would overpay. */
export function applyPayment(balance: MembershipBalance, amountPaise: number): MembershipBalance {
  return balanceOf(balance.amountPaise, addPaise(paise(balance.paidPaise), paise(amountPaise)));
}

/** The balance after a payment of `amountPaise` is voided: the paid total falls by exactly that amount. */
export function applyVoid(balance: MembershipBalance, amountPaise: number): MembershipBalance {
  return balanceOf(balance.amountPaise, subPaise(paise(balance.paidPaise), paise(amountPaise)));
}

/** null when valid, else a user-safe message. `outstandingPaise` is the cap (the membership's current balance). */
export function paymentAmountError(amountPaise: number, outstandingPaise: number): string | null {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return 'Amount must be greater than 0';
  if (amountPaise > MAX_PAISE) return 'Amount is too large';
  if (amountPaise > outstandingPaise) return `Amount exceeds pending balance (${formatInr(outstandingPaise)})`;
  return null;
}

/** null when valid. Today or a past day is accepted; a future IST day is not (NEW-5). Both are 00:00 IST days. */
export function paymentDateError(paymentDate: Date, today: Date): string | null {
  if (Number.isNaN(paymentDate.getTime()) || istDayStart(paymentDate).getTime() !== paymentDate.getTime()) {
    return 'Enter a valid payment date';
  }
  if (paymentDate.getTime() > istDayStart(today).getTime()) return 'Payment date cannot be in the future';
  return null;
}

/** Luhn checksum (mod 10) over a string of digits. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * True when the text contains what looks like a payment card number: 13 to 19 digits (optionally grouped by spaces or
 * dashes) that pass the Luhn check. Card data must never be stored (PCI-DSS scope, domain-context): the reference and notes
 * fields are for a UPI / bank / receipt reference only. A best-effort guard: the rules cannot run Luhn.
 */
export function looksLikeCardNumber(text: string): boolean {
  for (const run of text.match(/\d(?:[ -]?\d){12,18}/g) ?? []) {
    if (luhnValid(run.replace(/[ -]/g, ''))) return true;
  }
  return false;
}

export const CARD_NUMBER_MESSAGE = 'This looks like a card number. Never enter card numbers: use the UPI / bank / receipt reference instead.';

/** Collapse whitespace and trim; empty -> null. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  const t = (value ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** null when valid. Used for the transaction reference and the notes. */
export function paymentTextError(label: string, value: string | null, max: number): string | null {
  if (value === null) return null;
  if (value.length > max) return `${label} must be at most ${max} characters`;
  if (looksLikeCardNumber(value)) return CARD_NUMBER_MESSAGE;
  return null;
}

/** null when valid. A reason is required to void a payment (NEW-9). */
export function voidReasonError(reason: string): string | null {
  const t = reason.trim();
  if (t === '') return 'A reason is required to void a payment';
  if (t.length > VOID_REASON_MAX) return `The reason must be at most ${VOID_REASON_MAX} characters`;
  if (looksLikeCardNumber(t)) return CARD_NUMBER_MESSAGE;
  return null;
}

/**
 * Full validation of a payment about to be written (used inside the transactions). Returns the first problem as a user-safe
 * message, or null. `capPaise` is what may still be paid: the membership's outstanding (record payment) or the plan price
 * (first payment on a new membership).
 */
export function paymentDetailsError(details: PaymentDetails, capPaise: number, today: Date): string | null {
  return (
    paymentAmountError(details.amountPaise, capPaise) ??
    paymentDateError(details.paymentDate, today) ??
    (isPaymentMethod(details.method) ? null : 'Choose a payment method') ??
    paymentTextError('Reference', details.transactionReference, PAYMENT_REFERENCE_MAX) ??
    paymentTextError('Notes', details.notes, PAYMENT_NOTES_MAX)
  );
}
