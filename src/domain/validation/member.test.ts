import { describe, expect, it } from 'vitest';
import { fromCivilDate } from '../dates';
import {
  buildMemberFormSchema,
  EMPTY_MEMBER_FORM,
  NOTES_MAX,
  toMemberProfileInput,
  type MemberFormValues,
} from './member';

// "Now" = 19/09/2026 10:00 IST
const clock = () => new Date('2026-09-19T04:30:00.000Z');
const create = buildMemberFormSchema('create', clock);
const edit = buildMemberFormSchema('edit', clock);

const adult: MemberFormValues = {
  ...EMPTY_MEMBER_FORM,
  firstName: 'Rahul',
  lastName: 'Sharma',
  gender: 'MALE',
  dateOfBirth: '1995-05-10',
  mobile: '9876543210',
  joiningDate: '2026-09-19',
  consent: true,
};

/** Map of field -> first message for a failed parse. */
function errors(schema: typeof create, values: MemberFormValues): Record<string, string> {
  const r = schema.safeParse(values);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0]);
    out[key] ??= issue.message;
  }
  return out;
}

describe('required fields (US-2.4a)', () => {
  it('a valid adult registration passes', () => {
    expect(errors(create, adult)).toEqual({});
  });

  it('an empty form reports a specific message per required field', () => {
    const e = errors(create, EMPTY_MEMBER_FORM);
    expect(Object.keys(e).sort()).toEqual(
      ['consent', 'dateOfBirth', 'firstName', 'gender', 'joiningDate', 'lastName', 'mobile'].sort(),
    );
    expect(e.firstName).toBe('First name is required');
    expect(e.dateOfBirth).toBe('Date of birth is required');
    expect(e.mobile).toBe('Mobile number is required');
  });

  it('whitespace-only names are empty; names over 50 chars are refused', () => {
    expect(errors(create, { ...adult, firstName: '   ' }).firstName).toBe('First name is required');
    expect(errors(create, { ...adult, lastName: 'x'.repeat(51) }).lastName).toMatch(/at most 50/);
    expect(errors(create, { ...adult, lastName: 'x'.repeat(50) })).toEqual({});
  });

  it('gender must be one of the allowed values', () => {
    expect(errors(create, { ...adult, gender: 'ROBOT' }).gender).toBeDefined();
    expect(errors(create, { ...adult, gender: 'OTHER' })).toEqual({});
  });
});

describe('mobile and email (US-2.4b)', () => {
  it.each(['12345', '5876543210', '98765abcde', '98765432101'])('rejects mobile %j', (mobile) => {
    expect(errors(create, { ...adult, mobile }).mobile).toMatch(/valid 10-digit mobile/);
  });

  it.each(['+91 98765 43210', '09876543210', '9876543210'])('accepts mobile %j', (mobile) => {
    expect(errors(create, { ...adult, mobile })).toEqual({});
  });

  it('email is optional but must be valid when present', () => {
    expect(errors(create, { ...adult, email: '' })).toEqual({});
    expect(errors(create, { ...adult, email: 'rahul@example.com' })).toEqual({});
    expect(errors(create, { ...adult, email: 'not-an-email' }).email).toBe('Enter a valid email address');
    expect(errors(create, { ...adult, email: 'a@b' }).email).toBeDefined();
  });
});

describe('dates (US-2.4b)', () => {
  it('a future date of birth or joining date is refused', () => {
    expect(errors(create, { ...adult, dateOfBirth: '2026-09-20' }).dateOfBirth).toMatch(/future/);
    expect(errors(create, { ...adult, joiningDate: '2026-09-20' }).joiningDate).toMatch(/future/);
  });

  it('today (IST) is allowed for both', () => {
    expect(errors(create, { ...adult, dateOfBirth: '2026-09-19', joiningDate: '2026-09-19', emergencyName: 'G', emergencyMobile: '9123456789' })).toEqual({});
  });

  it('a joining date at 00:30 IST "tomorrow" on a UTC-evening clock is still the future', () => {
    // 19/09 19:00 UTC is already 20/09 00:30 IST
    const lateClock = buildMemberFormSchema('create', () => new Date('2026-09-19T19:00:00.000Z'));
    expect(errors(lateClock, { ...adult, joiningDate: '2026-09-20' })).toEqual({});
    expect(errors(lateClock, { ...adult, joiningDate: '2026-09-21' }).joiningDate).toMatch(/future/);
  });

  it('impossible or malformed dates are refused', () => {
    expect(errors(create, { ...adult, dateOfBirth: '2026-02-30' }).dateOfBirth).toMatch(/valid/);
    expect(errors(create, { ...adult, joiningDate: '19/09/2026' }).joiningDate).toMatch(/valid/);
  });

  it('age over 100 is refused; exactly 100 is allowed', () => {
    expect(errors(create, { ...adult, dateOfBirth: '1925-09-19' }).dateOfBirth).toMatch(/100/); // 101 today
    expect(errors(create, { ...adult, dateOfBirth: '1925-09-20' })).toEqual({}); // 100 today, turns 101 tomorrow
  });
});

describe('emergency contact (US-2.4c)', () => {
  it('both-or-neither for an adult', () => {
    expect(errors(create, { ...adult, emergencyName: 'Sita' }).emergencyMobile).toMatch(/required/);
    expect(errors(create, { ...adult, emergencyMobile: '9123456789' }).emergencyName).toMatch(/required/);
    expect(errors(create, { ...adult, emergencyName: 'Sita', emergencyMobile: '9123456789' })).toEqual({});
  });

  it('the emergency mobile must be valid', () => {
    expect(errors(create, { ...adult, emergencyName: 'Sita', emergencyMobile: '123' }).emergencyMobile).toMatch(
      /valid 10-digit/,
    );
  });
});

describe('under 18 (US-2.7)', () => {
  // born 20/09/2008: turns 18 tomorrow => still under 18 today (19/09/2026)
  const minor: MemberFormValues = { ...adult, dateOfBirth: '2008-09-20' };
  // born 19/09/2008: turns 18 today => adult
  const justAdult: MemberFormValues = { ...adult, dateOfBirth: '2008-09-19' };

  it('requires the guardian (emergency contact) name and mobile', () => {
    const e = errors(create, minor);
    expect(e.emergencyName).toBe('Guardian name is required');
    expect(e.emergencyMobile).toBe('Guardian mobile number is required');
  });

  it('passes once guardian details are given', () => {
    expect(errors(create, { ...minor, emergencyName: 'Parent', emergencyMobile: '9123456789' })).toEqual({});
  });

  it('turning 18 today removes the guardian requirement', () => {
    expect(errors(create, justAdult)).toEqual({});
  });

  it('consent is described as guardian consent for a minor', () => {
    const e = errors(create, { ...minor, emergencyName: 'P', emergencyMobile: '9123456789', consent: false });
    expect(e.consent).toBe('Guardian consent is required for a member under 18');
  });

  it('the guardian requirement also applies when editing', () => {
    expect(errors(edit, minor).emergencyName).toBe('Guardian name is required');
  });
});

describe('consent (US-2.7b)', () => {
  it('registration is blocked without consent', () => {
    expect(errors(create, { ...adult, consent: false }).consent).toMatch(/Consent is required/);
  });

  it('edit mode does not re-ask for consent', () => {
    expect(errors(edit, { ...adult, consent: false })).toEqual({});
  });
});

describe('notes and trimming', () => {
  it('notes are capped at 1000 characters', () => {
    expect(errors(create, { ...adult, generalNotes: 'x'.repeat(NOTES_MAX + 1) }).generalNotes).toMatch(/1000/);
    expect(errors(create, { ...adult, medicalNotes: 'x'.repeat(NOTES_MAX + 1) }).medicalNotes).toMatch(/1000/);
    expect(errors(create, { ...adult, medicalNotes: 'x'.repeat(NOTES_MAX) })).toEqual({});
  });

  it('parsing trims surrounding spaces (US-2.4d)', () => {
    const r = create.parse({ ...adult, firstName: '  Rahul  ', lastName: ' Sharma ' });
    expect(r.firstName).toBe('Rahul');
    expect(r.lastName).toBe('Sharma');
  });
});

describe('toMemberProfileInput', () => {
  it('normalizes and anchors dates to 00:00 IST', () => {
    const p = toMemberProfileInput({
      ...adult,
      firstName: '  Mary   Ann ',
      mobile: '+91 98765 43210',
      email: ' r@example.com ',
      emergencyName: 'Sita',
      emergencyMobile: '09123456789',
      trainerId: 't1',
      generalNotes: '  hello ',
    });
    expect(p).toEqual({
      firstName: 'Mary Ann',
      lastName: 'Sharma',
      gender: 'MALE',
      dateOfBirth: fromCivilDate(1995, 5, 10),
      mobile: '9876543210',
      email: 'r@example.com',
      address: null,
      emergencyContact: { name: 'Sita', mobile: '9123456789' },
      trainerId: 't1',
      joiningDate: fromCivilDate(2026, 9, 19),
      generalNotes: 'hello',
    });
    expect(p.dateOfBirth.toISOString()).toBe('1995-05-09T18:30:00.000Z');
  });

  it('turns empty optionals into null', () => {
    const p = toMemberProfileInput(adult);
    expect(p).toMatchObject({ email: null, address: null, emergencyContact: null, trainerId: null, generalNotes: null });
  });

  it('refuses unvalidated values', () => {
    expect(() => toMemberProfileInput({ ...adult, mobile: '123' })).toThrow();
    expect(() => toMemberProfileInput({ ...adult, gender: '' })).toThrow();
  });
});
