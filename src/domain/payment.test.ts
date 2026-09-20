import { describe, expect, it } from 'vitest';
import { fromCivilDate } from './dates';
import { MoneyError, toPaise } from './money';
import {
  applyPayment,
  applyVoid,
  balanceOf,
  CARD_NUMBER_MESSAGE,
  looksLikeCardNumber,
  normalizeOptionalText,
  paymentAmountError,
  paymentDateError,
  paymentDetailsError,
  paymentState,
  paymentTextError,
  voidReasonError,
  type MembershipBalance,
} from './payment';

/**
 * US-8.1a / US-4.3: payment balance and multi-membership cases. Money is INTEGER PAISE everywhere (D-6); the requirement's examples are
 * written in rupees and converted with toPaise so a floating-point regression shows up as a failing example.
 */
const rs = (rupees: string | number) => toPaise(rupees) as number;
const fresh = (amount: number): MembershipBalance => balanceOf(rs(amount), 0);

describe('AC-8: total 1500 and payments 500 + 700 -> outstanding 300', () => {
  it('applies payments one after another, exactly', () => {
    let b = fresh(1500);
    expect(b).toEqual({ amountPaise: 150000, paidPaise: 0, outstandingPaise: 150000, unpaid: true });
    b = applyPayment(b, rs(500));
    expect(b).toMatchObject({ paidPaise: 50000, outstandingPaise: 100000, unpaid: true });
    b = applyPayment(b, rs(700));
    expect(b).toMatchObject({ paidPaise: 120000, outstandingPaise: 30000, unpaid: true });
    expect(paymentState(b.amountPaise, b.paidPaise)).toBe('PARTIAL');
    b = applyPayment(b, rs(300));
    expect(b).toMatchObject({ paidPaise: 150000, outstandingPaise: 0, unpaid: false });
    expect(paymentState(b.amountPaise, b.paidPaise)).toBe('PAID');
  });

  it('overpaying (by even 1 paisa) throws, and so does a negative amount: never a negative balance', () => {
    const b = applyPayment(fresh(1500), rs(1200));
    expect(() => applyPayment(b, 30001)).toThrow(MoneyError);
    expect(() => applyPayment(b, -1)).toThrow(MoneyError);
    expect(() => applyPayment(fresh(1500), rs(1500) + 1)).toThrow(MoneyError);
    expect(applyPayment(b, 30000).outstandingPaise).toBe(0);
  });

  it('decimals do not drift: 0.1 + 0.2 = 0.30 exactly and 3 x 0.10 sums to exactly 30 paise', () => {
    let b = fresh(1);
    for (const amount of ['0.1', '0.2']) b = applyPayment(b, rs(amount));
    expect(b.paidPaise).toBe(30);
    expect(b.outstandingPaise).toBe(70);
    let c = fresh(100);
    for (let i = 0; i < 1000; i++) c = applyPayment(c, 10);
    expect(c.paidPaise).toBe(10_000);
    expect(c.outstandingPaise).toBe(0);
  });

  it('fractional paise cannot enter: toPaise refuses a third decimal', () => {
    expect(() => toPaise('1.005')).toThrow(MoneyError);
    expect(() => balanceOf(150000, 0.5)).toThrow(MoneyError);
    expect(() => balanceOf(150000.5, 0)).toThrow(MoneyError);
  });
});

describe('void (TX-5): restores the balance exactly and is the inverse of a payment', () => {
  it('apply then void returns to the starting balance', () => {
    const start = applyPayment(fresh(1500), rs(500));
    const paid = applyPayment(start, rs(250.5));
    expect(applyVoid(paid, rs(250.5))).toEqual(start);
  });

  it('a void larger than what was paid throws', () => {
    expect(() => applyVoid(applyPayment(fresh(1500), rs(500)), rs(500) + 1)).toThrow(MoneyError);
  });
});

describe('multi-membership: member pending = sum of outstanding across memberships (D-7); payments never allocate automatically', () => {
  it('old unpaid dues carry forward and a payment against one membership leaves the other untouched', () => {
    const expired = applyPayment(fresh(1500), rs(500)); // 1000 still owed on the expired membership
    const renewed = fresh(1500); // 1500 owed on the renewal
    const pending = (list: MembershipBalance[]) => list.reduce((sum, m) => sum + m.outstandingPaise, 0);
    expect(pending([expired, renewed])).toBe(rs(2500));
    const afterPay = applyPayment(renewed, rs(1500));
    expect(pending([expired, afterPay])).toBe(rs(1000)); // the expired one is unchanged
    expect(expired.outstandingPaise).toBe(rs(1000));
  });

  it('paying a membership in full cannot reach into another: the cap is that membership\'s own outstanding', () => {
    const small = fresh(600);
    expect(paymentAmountError(rs(1000), small.outstandingPaise)).toBe('Amount exceeds pending balance (₹600.00)');
    expect(paymentAmountError(rs(600), small.outstandingPaise)).toBeNull();
  });
});

describe('paymentState (D-7): UNPAID / PARTIAL / PAID are derived', () => {
  it.each([
    [150000, 0, 'UNPAID'],
    [150000, 1, 'PARTIAL'],
    [150000, 149999, 'PARTIAL'],
    [150000, 150000, 'PAID'],
    [150000, 150001, 'PAID'],
  ] as const)('total %d, paid %d -> %s', (total, paid, state) => {
    expect(paymentState(total, paid)).toBe(state);
  });
});

describe('paymentAmountError', () => {
  it.each([
    [0, 'Amount must be greater than 0'],
    [-5, 'Amount must be greater than 0'],
    [1.5, 'Amount must be greater than 0'],
    [Number.NaN, 'Amount must be greater than 0'],
    [Number.POSITIVE_INFINITY, 'Amount must be greater than 0'],
  ])('%s is refused: "%s"', (amount, message) => {
    expect(paymentAmountError(amount, 100000)).toBe(message);
  });

  it('above the cap is refused with the balance in rupees; exactly the balance and 1 paisa are fine', () => {
    expect(paymentAmountError(100001, 100000)).toBe('Amount exceeds pending balance (₹1,000.00)');
    expect(paymentAmountError(100000, 100000)).toBeNull();
    expect(paymentAmountError(1, 100000)).toBeNull();
  });

  it('an absurd amount is "too large" even if the cap would allow it', () => {
    expect(paymentAmountError(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe('Amount is too large');
  });
});

describe('paymentDateError (NEW-5): today or the past, never a future IST day', () => {
  const today = fromCivilDate(2026, 9, 19);

  it('today and earlier days are accepted, tomorrow is not', () => {
    expect(paymentDateError(today, today)).toBeNull();
    expect(paymentDateError(fromCivilDate(2026, 9, 18), today)).toBeNull();
    expect(paymentDateError(fromCivilDate(2020, 1, 1), today)).toBeNull();
    expect(paymentDateError(fromCivilDate(2026, 9, 20), today)).toBe('Payment date cannot be in the future');
  });

  it('a date that is not a whole IST day (a browser-local Date that skipped fromCivilDate) is refused', () => {
    expect(paymentDateError(new Date('2026-09-19T00:00:00Z'), today)).toBe('Enter a valid payment date');
    expect(paymentDateError(new Date(Number.NaN), today)).toBe('Enter a valid payment date');
  });

  it('"today" carries a time of day: only its IST day counts (23:59 IST is still 19/09)', () => {
    expect(paymentDateError(today, new Date('2026-09-19T18:29:59Z'))).toBeNull();
    expect(paymentDateError(fromCivilDate(2026, 9, 20), new Date('2026-09-19T18:29:59Z'))).toBe('Payment date cannot be in the future');
    expect(paymentDateError(fromCivilDate(2026, 9, 20), new Date('2026-09-19T18:30:00Z'))).toBeNull(); // 20/09 00:00 IST
  });
});

describe('no card data is ever stored (PCI-DSS avoidance)', () => {
  it.each([
    ['4111111111111111', true], // Visa test number
    ['4111 1111 1111 1111', true],
    ['4111-1111-1111-1111', true],
    ['card 5555555555554444 ok', true], // Mastercard test number inside text
    ['378282246310005', true], // Amex, 15 digits
    ['6011111111111117', true],
    ['4111111111111112', false], // fails Luhn
    ['UPI-2026-09-19-000123', false],
    ['123456789012', false], // 12 digits
    ['NEFT 0912345678901', false], // 13 digits but not Luhn-valid
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(looksLikeCardNumber(text)).toBe(expected);
  });

  it('the reference, the notes and the void reason all refuse a card-like number', () => {
    expect(paymentTextError('Reference', '4111111111111111', 100)).toBe(CARD_NUMBER_MESSAGE);
    expect(paymentTextError('Notes', 'paid with 4111 1111 1111 1111', 500)).toBe(CARD_NUMBER_MESSAGE);
    expect(voidReasonError('refund to 4111111111111111')).toBe(CARD_NUMBER_MESSAGE);
    expect(paymentTextError('Reference', null, 100)).toBeNull();
    expect(paymentTextError('Reference', 'x'.repeat(101), 100)).toBe('Reference must be at most 100 characters');
  });
});

describe('voidReasonError (NEW-9): a reason is required', () => {
  it.each([['', true], ['   ', true], ['wrong member', false]])('%j -> refused: %s', (reason, refused) => {
    expect(voidReasonError(reason) !== null).toBe(refused);
  });
  it('is limited to 200 characters', () => {
    expect(voidReasonError('x'.repeat(200))).toBeNull();
    expect(voidReasonError('x'.repeat(201))).toBe('The reason must be at most 200 characters');
  });
});

describe('paymentDetailsError (used inside the transaction)', () => {
  const today = fromCivilDate(2026, 9, 19);
  const ok = { amountPaise: 50000, paymentDate: today, method: 'UPI' as const, transactionReference: 'UPI-1', notes: null };

  it('accepts valid details and reports the first problem otherwise', () => {
    expect(paymentDetailsError(ok, 100000, today)).toBeNull();
    expect(paymentDetailsError({ ...ok, amountPaise: 0 }, 100000, today)).toBe('Amount must be greater than 0');
    expect(paymentDetailsError({ ...ok, amountPaise: 100001 }, 100000, today)).toMatch(/exceeds pending balance/);
    expect(paymentDetailsError({ ...ok, paymentDate: fromCivilDate(2026, 9, 20) }, 100000, today)).toBe('Payment date cannot be in the future');
    expect(paymentDetailsError({ ...ok, method: 'BITCOIN' as never }, 100000, today)).toBe('Choose a payment method');
    expect(paymentDetailsError({ ...ok, notes: '4111111111111111' }, 100000, today)).toBe(CARD_NUMBER_MESSAGE);
  });
});

describe('normalizeOptionalText', () => {
  it.each([[null, null], [undefined, null], ['', null], ['   ', null], ['  a   b  ', 'a b']])('%j -> %j', (input, expected) => {
    expect(normalizeOptionalText(input)).toBe(expected);
  });
});
