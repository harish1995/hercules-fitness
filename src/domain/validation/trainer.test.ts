import { describe, expect, it } from 'vitest';
import { toTrainerInput, trainerFormSchema } from './trainer';

describe('trainerFormSchema (NEW-2)', () => {
  it('name required; mobile optional', () => {
    expect(trainerFormSchema.safeParse({ name: 'Amit', mobile: '', active: true }).success).toBe(true);
    const r = trainerFormSchema.safeParse({ name: '  ', mobile: '', active: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Name is required');
  });

  it('a mobile, when present, must be a valid Indian mobile', () => {
    expect(trainerFormSchema.safeParse({ name: 'Amit', mobile: '12345', active: true }).success).toBe(false);
    expect(trainerFormSchema.safeParse({ name: 'Amit', mobile: '+91 98765 43210', active: true }).success).toBe(true);
  });

  it('name is capped at 80 characters', () => {
    expect(trainerFormSchema.safeParse({ name: 'x'.repeat(81), mobile: '', active: true }).success).toBe(false);
  });

  it('toTrainerInput normalizes', () => {
    expect(toTrainerInput({ name: ' Amit   Kumar ', mobile: '09876543210', active: false })).toEqual({
      name: 'Amit Kumar',
      mobile: '9876543210',
      active: false,
    });
    expect(toTrainerInput({ name: 'A', mobile: ' ', active: true }).mobile).toBeNull();
  });
});
