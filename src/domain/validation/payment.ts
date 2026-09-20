import { isPaymentMethod } from '../../constants/enums';
import { type PaymentDetails } from '../../types/payment';
import { parseDayInput, systemClock, toDayInputValue, todayIstStart, type Clock } from '../dates';
import { MoneyError, toPaise } from '../money';
import {
  normalizeOptionalText,
  PAYMENT_NOTES_MAX,
  PAYMENT_REFERENCE_MAX,
  paymentAmountError,
  paymentDateError,
  paymentTextError,
} from '../payment';

/**
 * The payment fields of a form (registration, renew, record-payment dialog): every input is a string, exactly as the
 * inputs hold them. `validatePaymentForm` is the ONE place they are checked and converted to typed, IST-anchored,
 * integer-paise `PaymentDetails`, so the three forms cannot disagree (US-4.1c/d, US-4.2).
 */
export interface PaymentFormValues {
  /** Rupees as typed, e.g. `1500` or `1,500.50`. Blank / `0` on the first-payment section = no payment. */
  paymentAmount: string;
  /** `YYYY-MM-DD` */
  paymentDate: string;
  paymentMethod: string;
  paymentReference: string;
  paymentNotes: string;
}

export type PaymentFieldErrors = Partial<Record<keyof PaymentFormValues, string>>;

/** Blank fields; the payment date defaults to today (IST) so recording "received today" needs no typing. */
export function emptyPaymentForm(clock: Clock = systemClock): PaymentFormValues {
  return {
    paymentAmount: '',
    paymentDate: toDayInputValue(todayIstStart(clock)),
    paymentMethod: '',
    paymentReference: '',
    paymentNotes: '',
  };
}

export interface PaymentFormResult {
  errors: PaymentFieldErrors;
  /** null when there is no payment (blank / zero amount on an optional section) or when there are errors */
  details: PaymentDetails | null;
}

interface Options {
  /** what may still be paid: the membership's outstanding, or the plan price for a first payment (paise) */
  capPaise: number;
  /** false (first-payment section): a blank or 0 amount means "no payment" and nothing else is required */
  required: boolean;
  clock?: Clock;
}

/**
 * Amount: > 0, at most 2 decimals, not more than `capPaise` (US-4.1b/c, US-4.2d). When an amount is given the method and a
 * valid date that is not in the future are required (US-4.2c, NEW-5); reference and notes are optional, length-limited and
 * must not look like a card number.
 */
export function validatePaymentForm(values: PaymentFormValues, options: Options): PaymentFormResult {
  const { capPaise, required, clock = systemClock } = options;
  const errors: PaymentFieldErrors = {};
  const raw = values.paymentAmount.trim();
  // blank on the optional first-payment section = no payment record (US-4.2b)
  if (raw === '' && !required) return { errors, details: null };

  let amountPaise: number | null = null;
  if (raw === '') {
    errors.paymentAmount = 'Enter the amount received';
  } else {
    try {
      amountPaise = toPaise(raw);
    } catch (e) {
      errors.paymentAmount = e instanceof MoneyError ? e.message : 'Enter a valid amount';
    }
  }
  // "Amount paid = 0" on the optional first-payment section also means no payment record (US-4.2b)
  if (amountPaise === 0 && !required) return { errors, details: null };
  if (amountPaise !== null) {
    const problem = paymentAmountError(amountPaise, capPaise);
    if (problem) errors.paymentAmount = required ? problem : problem.replace(/^Amount exceeds pending balance.*$/, 'Amount paid cannot be more than the total amount');
  }

  const date = parseDayInput(values.paymentDate);
  if (values.paymentDate.trim() === '') errors.paymentDate = 'Payment date is required';
  else if (!date) errors.paymentDate = 'Enter a valid payment date';
  else {
    const problem = paymentDateError(date, todayIstStart(clock));
    if (problem) errors.paymentDate = problem;
  }

  if (!isPaymentMethod(values.paymentMethod)) errors.paymentMethod = 'Select a payment method';

  const reference = normalizeOptionalText(values.paymentReference);
  const notes = normalizeOptionalText(values.paymentNotes);
  const refProblem = paymentTextError('Reference', reference, PAYMENT_REFERENCE_MAX);
  if (refProblem) errors.paymentReference = refProblem;
  const notesProblem = paymentTextError('Notes', notes, PAYMENT_NOTES_MAX);
  if (notesProblem) errors.paymentNotes = notesProblem;

  if (Object.keys(errors).length > 0 || amountPaise === null || date === null || !isPaymentMethod(values.paymentMethod)) {
    return { errors, details: null };
  }
  return { errors, details: { amountPaise, paymentDate: date, method: values.paymentMethod, transactionReference: reference, notes } };
}

/** Pending (display only, never typed or stored): total minus a valid amount paid, else the whole total. */
export function pendingPreviewPaise(totalPaise: number, amountText: string): number {
  const raw = amountText.trim();
  if (raw === '') return totalPaise;
  try {
    const paid = toPaise(raw);
    return paid > totalPaise ? totalPaise : totalPaise - paid;
  } catch {
    return totalPaise;
  }
}

/** Integer paise -> the rupee text an input takes (`150000` -> `1500.00`), built from integers so nothing is rounded. */
export function toRupeeInput(paise: number): string {
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}
