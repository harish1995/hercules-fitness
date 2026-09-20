import { describe, expect, it } from 'vitest';
import { fromCivilDate } from './dates';
import { changedProfileFields, memberAuditLabel } from './memberDiff';
import { type MemberProfileInput } from '../types/member';

const base: MemberProfileInput = {
  firstName: 'Rahul',
  lastName: 'Sharma',
  gender: 'MALE',
  dateOfBirth: fromCivilDate(1995, 5, 10),
  mobile: '9876543210',
  email: null,
  address: null,
  emergencyContact: null,
  trainerId: null,
  joiningDate: fromCivilDate(2026, 9, 1),
  generalNotes: null,
};

describe('changedProfileFields (audit lists field NAMES only, FR-13)', () => {
  it('is empty when nothing changed (dates compared by value, not identity)', () => {
    expect(
      changedProfileFields(base, { ...base, dateOfBirth: fromCivilDate(1995, 5, 10), joiningDate: fromCivilDate(2026, 9, 1) }),
    ).toEqual([]);
  });

  it('lists exactly the changed fields in a stable order', () => {
    expect(changedProfileFields(base, { ...base, address: '12 MG Road', firstName: 'Rahil' })).toEqual([
      'firstName',
      'address',
    ]);
  });

  it('detects date, emergency contact and trainer changes', () => {
    const after: MemberProfileInput = {
      ...base,
      dateOfBirth: fromCivilDate(1995, 5, 11),
      emergencyContact: { name: 'Sita', mobile: '9123456789' },
      trainerId: 't1',
    };
    expect(changedProfileFields(base, after)).toEqual(['dateOfBirth', 'emergencyContact', 'trainerId']);
    expect(
      changedProfileFields(after, { ...after, emergencyContact: { name: 'Sita', mobile: '9123456780' } }),
    ).toEqual(['emergencyContact']);
    expect(changedProfileFields(after, { ...after, emergencyContact: null })).toEqual(['emergencyContact']);
  });

  it('never contains values, only names', () => {
    const names = changedProfileFields(base, { ...base, address: 'secret street', mobile: '9000000000' });
    expect(names.join(',')).not.toMatch(/secret|9000000000/);
  });
});

describe('memberAuditLabel', () => {
  it('is "<member id> <name>"', () => {
    expect(memberAuditLabel('GYM-2026-0001', 'Rahul Sharma')).toBe('GYM-2026-0001 Rahul Sharma');
  });
});
