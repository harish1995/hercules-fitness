import { describe, expect, it } from 'vitest';
import { addPaise, formatInr, fromPaise, MoneyError, paise, subPaise, toPaise } from './money';

describe('toPaise (D-6)', () => {
  it.each([
    ['1500', 150000],
    ['1500.5', 150050],
    ['1500.50', 150050],
    ['0.30', 30],
    ['0.1', 10],
    ['0', 0],
    ['1,50,000', 15000000],
    [' 99.99 ', 9999],
    [0.3, 30],
    [1500, 150000],
  ])('%j -> %d paise', (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it('0.1 + 0.2 is exactly 30 paise (no floating point drift)', () => {
    expect(addPaise(toPaise('0.1'), toPaise('0.2'))).toBe(30);
    expect(toPaise(0.1 + 0.2)).toBe(30); // binary noise 0.30000000000000004 is tolerated on numbers
  });

  it.each(['', '  ', '-1', '-0.5', 'abc', '1.234', '12.', '.5', '1e3', 'NaN', '1..2', '1,2,3.456'])(
    'rejects %j',
    (input) => {
      expect(() => toPaise(input)).toThrow(MoneyError);
    },
  );

  it.each([-1, NaN, Infinity, 0.125, 1e15])('rejects the number %s', (input) => {
    expect(() => toPaise(input)).toThrow(MoneyError);
  });
});

describe('arithmetic guards', () => {
  it('adds and subtracts exactly', () => {
    expect(addPaise(paise(50000), paise(70000))).toBe(120000);
    expect(subPaise(paise(150000), paise(120000))).toBe(30000); // total 1500, paid 500 + 700 => outstanding 300
  });

  it('refuses a negative result and overflow', () => {
    expect(() => subPaise(paise(100), paise(101))).toThrow(MoneyError);
    expect(() => paise(1.5)).toThrow(MoneyError);
    expect(() => paise(-1)).toThrow(MoneyError);
    expect(() => paise(Number.MAX_SAFE_INTEGER)).toThrow(MoneyError);
  });
});

describe('formatInr / fromPaise', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [150000, '₹1,500.00'],
    [12345678, '₹1,23,456.78'],
    [10000000, '₹1,00,000.00'],
    [-2550, '-₹25.50'],
  ])('%d -> %s', (value, text) => {
    expect(formatInr(value)).toBe(text);
  });

  it('refuses fractional paise', () => {
    expect(() => formatInr(10.5)).toThrow(MoneyError);
  });

  it('fromPaise gives display rupees', () => {
    expect(fromPaise(150050)).toBe(1500.5);
  });
});
