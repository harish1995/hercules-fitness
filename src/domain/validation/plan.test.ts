import { describe, expect, it } from 'vitest';
import { planFormSchema, toPlanInput, type PlanFormValues } from './plan';

/** US-8.1a validation rules / US-3.1b: a name, a positive whole duration within the limits, a price above 0 with at most 2 decimals. */
const values = (over: Partial<PlanFormValues> = {}): PlanFormValues => ({
  name: 'Monthly',
  durationValue: '1',
  durationUnit: 'MONTHS',
  price: '1500',
  description: '',
  active: true,
  ...over,
});
const messages = (over: Partial<PlanFormValues>) => {
  const r = planFormSchema.safeParse(values(over));
  const out: Record<string, string> = {};
  for (const i of r.success ? [] : r.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
};

describe('planFormSchema', () => {
  it('accepts a valid plan and converts the price to integer paise', () => {
    expect(planFormSchema.safeParse(values()).success).toBe(true);
    expect(toPlanInput(values({ name: '  Gold   Plan ', price: '1,499.50', description: '  best   value ' }))).toEqual({
      name: 'Gold Plan', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 149950, description: 'best value', active: true,
    });
    expect(toPlanInput(values({ description: '' })).description).toBeNull();
  });

  it.each([
    [{ name: '' }, { name: 'Name is required' }],
    [{ name: '   ' }, { name: 'Name is required' }],
    [{ name: 'x'.repeat(61) }, { name: 'Name must be at most 60 characters' }],
    [{ durationValue: '' }, { durationValue: 'Duration is required' }],
    [{ durationValue: '0' }, { durationValue: 'Duration must be a whole number of at least 1' }],
    [{ durationValue: '-3' }, { durationValue: 'Duration must be a whole number' }],
    [{ durationValue: '1.5' }, { durationValue: 'Duration must be a whole number' }],
    [{ durationValue: 'abc' }, { durationValue: 'Duration must be a whole number' }],
    [{ durationValue: '121', durationUnit: 'MONTHS' }, { durationValue: 'Duration cannot be more than 120 months' }],
    [{ durationValue: '3651', durationUnit: 'DAYS' }, { durationValue: 'Duration cannot be more than 3650 days' }],
    [{ durationUnit: 'YEARS' }, { durationUnit: 'Choose days or months' }],
    [{ price: '' }, { price: 'Price is required' }],
    [{ price: '0' }, { price: 'Price must be greater than 0' }],
    [{ price: '-100' }, { price: 'Enter a valid amount' }],
    [{ price: '10.999' }, { price: 'Amount cannot have more than 2 decimal places' }],
    [{ price: 'free' }, { price: 'Enter a valid amount' }],
    [{ description: 'x'.repeat(301) }, { description: 'Description must be at most 300 characters' }],
  ] as const)('%j is refused with %j', (over, expected) => {
    expect(messages(over as Partial<PlanFormValues>)).toMatchObject(expected);
  });

  it('the limits are inclusive: 120 months, 3650 days, a 60-character name, a 1-paisa price', () => {
    expect(planFormSchema.safeParse(values({ durationValue: '120' })).success).toBe(true);
    expect(planFormSchema.safeParse(values({ durationValue: '3650', durationUnit: 'DAYS' })).success).toBe(true);
    expect(planFormSchema.safeParse(values({ name: 'x'.repeat(60) })).success).toBe(true);
    expect(planFormSchema.safeParse(values({ price: '0.01' })).success).toBe(true);
  });

  it('toPlanInput refuses unvalidated values', () => {
    expect(() => toPlanInput(values({ durationUnit: 'YEARS' }))).toThrow(/unvalidated/);
  });
});
