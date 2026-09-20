import { describe, expect, it } from 'vitest';
import { fromCivilDate } from '../dates';
import { emptyPaymentForm, pendingPreviewPaise, toRupeeInput, validatePaymentForm, type PaymentFormValues } from './payment';

/** US-8.1a validation rules / US-4.1 / US-4.2: the ONE place a payment form becomes typed, IST-anchored, integer-paise details. */
const clock = () => new Date('2026-09-19T06:30:00Z'); // 12:00 IST, 19/09/2026
const form = (over: Partial<PaymentFormValues> = {}): PaymentFormValues => ({
  paymentAmount: '500',
  paymentDate: '2026-09-19',
  paymentMethod: 'UPI',
  paymentReference: 'UPI-1',
  paymentNotes: '',
  ...over,
});
const record = (over: Partial<PaymentFormValues> = {}, cap = 150000) => validatePaymentForm(form(over), { capPaise: cap, required: true, clock });
const optional = (over: Partial<PaymentFormValues> = {}, cap = 150000) => validatePaymentForm(form(over), { capPaise: cap, required: false, clock });

describe('record-payment dialog (amount required)', () => {
  it('a valid form becomes integer paise, an IST-midnight date and a normalized reference', () => {
    const r = record({ paymentAmount: '1,250.50', paymentReference: '  UPI   123 ' });
    expect(r.errors).toEqual({});
    expect(r.details).toEqual({
      amountPaise: 125050,
      paymentDate: fromCivilDate(2026, 9, 19),
      method: 'UPI',
      transactionReference: 'UPI 123',
      notes: null,
    });
  });

  it.each([
    ['', 'Enter the amount received'],
    ['0', 'Amount must be greater than 0'],
    ['-5', 'Enter a valid amount'],
    ['1.234', 'Amount cannot have more than 2 decimal places'],
    ['abc', 'Enter a valid amount'],
    ['1e3', 'Enter a valid amount'],
    ['1501', 'Amount exceeds pending balance (₹1,500.00)'],
  ])('amount %j -> "%s"', (amount, message) => {
    const r = record({ paymentAmount: amount });
    expect(r.errors.paymentAmount).toBe(message);
    expect(r.details).toBeNull();
  });

  it('exactly the balance is accepted', () => {
    expect(record({ paymentAmount: '1500' }).details?.amountPaise).toBe(150000);
  });

  it('a future date, an impossible date, a blank date and a missing method are each refused', () => {
    expect(record({ paymentDate: '2026-09-20' }).errors.paymentDate).toBe('Payment date cannot be in the future');
    expect(record({ paymentDate: '2026-02-30' }).errors.paymentDate).toBe('Enter a valid payment date');
    expect(record({ paymentDate: '' }).errors.paymentDate).toBe('Payment date is required');
    expect(record({ paymentMethod: '' }).errors.paymentMethod).toBe('Select a payment method');
    expect(record({ paymentMethod: 'BITCOIN' }).errors.paymentMethod).toBe('Select a payment method');
  });

  it('"today" is the IST day: 00:00 IST on 20/09 accepts 20/09 (a UTC clock would still say 19/09)', () => {
    const lateClock = () => new Date('2026-09-19T18:30:00Z');
    const r = validatePaymentForm(form({ paymentDate: '2026-09-20' }), { capPaise: 150000, required: true, clock: lateClock });
    expect(r.errors).toEqual({});
  });

  it('a card-like number in the reference or the notes is refused (no card data stored)', () => {
    expect(record({ paymentReference: '4111 1111 1111 1111' }).errors.paymentReference).toMatch(/card number/);
    expect(record({ paymentNotes: 'paid 4111111111111111' }).errors.paymentNotes).toMatch(/card number/);
  });

  it('reference over 100 and notes over 500 characters are refused', () => {
    expect(record({ paymentReference: 'x'.repeat(101) }).errors.paymentReference).toBe('Reference must be at most 100 characters');
    expect(record({ paymentNotes: 'x'.repeat(501) }).errors.paymentNotes).toBe('Notes must be at most 500 characters');
    expect(record({ paymentReference: 'x'.repeat(100), paymentNotes: 'y'.repeat(500) }).errors).toEqual({});
  });
});

describe('the optional first-payment section (registration / assign / renew)', () => {
  it.each(['', '   ', '0', '0.00'])('a blank or zero amount (%j) means NO payment and nothing else is required', (amount) => {
    const r = optional({ paymentAmount: amount, paymentMethod: '', paymentDate: '' });
    expect(r).toEqual({ errors: {}, details: null });
  });

  it('an amount needs a method and a valid date; more than the total says so in the "amount paid" wording', () => {
    const r = optional({ paymentAmount: '500', paymentMethod: '' });
    expect(r.errors.paymentMethod).toBe('Select a payment method');
    expect(r.details).toBeNull();
    expect(optional({ paymentAmount: '1600' }).errors.paymentAmount).toBe('Amount paid cannot be more than the total amount');
    expect(optional({ paymentAmount: '1500' }).details?.amountPaise).toBe(150000);
  });
});

describe('helpers', () => {
  it('emptyPaymentForm defaults the date to today (IST) and everything else to blank', () => {
    expect(emptyPaymentForm(clock)).toEqual({ paymentAmount: '', paymentDate: '2026-09-19', paymentMethod: '', paymentReference: '', paymentNotes: '' });
    expect(emptyPaymentForm(() => new Date('2026-09-19T18:30:00Z')).paymentDate).toBe('2026-09-20');
  });

  it('pendingPreviewPaise: total minus a valid amount; the whole total for blank / invalid / over-paying input', () => {
    expect(pendingPreviewPaise(150000, '')).toBe(150000);
    expect(pendingPreviewPaise(150000, '500')).toBe(100000);
    expect(pendingPreviewPaise(150000, '1500')).toBe(0);
    expect(pendingPreviewPaise(150000, '1600')).toBe(150000);
    expect(pendingPreviewPaise(150000, 'abc')).toBe(150000);
    expect(pendingPreviewPaise(150000, '0.1')).toBe(149990);
  });

  it('toRupeeInput is built from integers: no rounding', () => {
    expect(toRupeeInput(150000)).toBe('1500.00');
    expect(toRupeeInput(5)).toBe('0.05');
    expect(toRupeeInput(123456789)).toBe('1234567.89');
  });
});
