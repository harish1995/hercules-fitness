import { describe, expect, it } from 'vitest';
import { diagnoseUserDoc, evaluateAccess, fieldType, isRoleAllowed } from './access';

describe('evaluateAccess (US-1.6a/b)', () => {
  it('grants an active ADMIN', () => {
    expect(evaluateAccess({ role: 'ADMIN', active: true })).toEqual({ granted: true, role: 'ADMIN' });
  });

  it('denies a missing users doc', () => {
    expect(evaluateAccess(null)).toEqual({ granted: false });
  });

  it('denies an inactive ADMIN', () => {
    expect(evaluateAccess({ role: 'ADMIN', active: false })).toEqual({ granted: false });
  });

  it('denies when active is not exactly true (missing/truthy junk)', () => {
    expect(evaluateAccess({ role: 'ADMIN', active: undefined })).toEqual({ granted: false });
    expect(evaluateAccess({ role: 'ADMIN', active: 'true' })).toEqual({ granted: false });
    expect(evaluateAccess({ role: 'ADMIN', active: 1 })).toEqual({ granted: false });
  });

  it('denies unknown role values, including lowercase and non-strings', () => {
    expect(evaluateAccess({ role: 'OWNER', active: true })).toEqual({ granted: false });
    expect(evaluateAccess({ role: 'admin', active: true })).toEqual({ granted: false });
    expect(evaluateAccess({ role: undefined, active: true })).toEqual({ granted: false });
    expect(evaluateAccess({ role: ['ADMIN'], active: true })).toEqual({ granted: false });
  });

  it('denies STAFF and MEMBER in Phase 1 (no UI yet)', () => {
    expect(evaluateAccess({ role: 'STAFF', active: true })).toEqual({ granted: false });
    expect(evaluateAccess({ role: 'MEMBER', active: true })).toEqual({ granted: false });
  });

  it('admitting STAFF later is only a matter of the allowed set', () => {
    expect(evaluateAccess({ role: 'STAFF', active: true }, ['ADMIN', 'STAFF'])).toEqual({
      granted: true,
      role: 'STAFF',
    });
  });
});

describe('isRoleAllowed', () => {
  it('is false for a null role', () => {
    expect(isRoleAllowed(null, ['ADMIN'])).toBe(false);
  });
  it('checks membership in the allow list', () => {
    expect(isRoleAllowed('ADMIN', ['ADMIN'])).toBe(true);
    expect(isRoleAllowed('STAFF', ['ADMIN'])).toBe(false);
  });
});

describe('diagnoseUserDoc (development diagnostics: reason + field TYPES only)', () => {
  const good = { email: 'owner@example.com', displayName: 'Gym Owner', role: 'ADMIN', active: true };

  it('returns null when access would be granted', () => {
    expect(diagnoseUserDoc(good)).toBeNull();
  });

  it('missing doc', () => {
    expect(diagnoseUserDoc(null)).toEqual({ reason: 'MISSING_USER_DOC', fieldTypes: {} });
    expect(diagnoseUserDoc(undefined)?.reason).toBe('MISSING_USER_DOC');
  });

  it('inactive', () => {
    expect(diagnoseUserDoc({ ...good, active: false })?.reason).toBe('INACTIVE');
  });

  it('unknown role (lowercase / not in the set)', () => {
    expect(diagnoseUserDoc({ ...good, role: 'admin' })?.reason).toBe('UNKNOWN_ROLE');
    expect(diagnoseUserDoc({ ...good, role: 'OWNER' })?.reason).toBe('UNKNOWN_ROLE');
  });

  it('a role without a UI in this phase', () => {
    expect(diagnoseUserDoc({ ...good, role: 'STAFF' })?.reason).toBe('ROLE_NOT_ALLOWED');
    expect(diagnoseUserDoc({ ...good, role: 'STAFF' }, ['ADMIN', 'STAFF'])).toBeNull();
  });

  it('wrong field types (e.g. active saved as the string "true", role as a number)', () => {
    const a = diagnoseUserDoc({ ...good, active: 'true' });
    expect(a?.reason).toBe('WRONG_FIELD_TYPE');
    expect(a?.fieldTypes).toMatchObject({ active: 'string', role: 'string', email: 'string' });
    expect(diagnoseUserDoc({ ...good, role: 1 })?.reason).toBe('WRONG_FIELD_TYPE');
    expect(diagnoseUserDoc({ ...good, email: undefined })?.reason).toBe('WRONG_FIELD_TYPE');
    expect(diagnoseUserDoc('ADMIN')?.reason).toBe('WRONG_FIELD_TYPE');
  });

  it('never contains any field VALUE, only types', () => {
    const d = diagnoseUserDoc({ ...good, active: 'true' });
    const dump = JSON.stringify(d);
    expect(dump).not.toContain('owner@example.com');
    expect(dump).not.toContain('Gym Owner');
    expect(dump).not.toContain('ADMIN');
  });
});

describe('fieldType', () => {
  it('distinguishes null, arrays and timestamps from plain objects', () => {
    expect(fieldType(null)).toBe('null');
    expect(fieldType([])).toBe('array');
    expect(fieldType({ toDate: () => new Date() })).toBe('timestamp');
    expect(fieldType({})).toBe('object');
    expect(fieldType(undefined)).toBe('undefined');
    expect(fieldType(true)).toBe('boolean');
  });
});
