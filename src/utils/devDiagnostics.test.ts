import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnoseUserDoc } from '../domain/access';
import { warnLoginRefused } from './devDiagnostics';

afterEach(() => {
  vi.unstubAllEnvs();
});

const badDoc = { email: 'owner@example.com', displayName: 'Gym Owner', role: 'ADMIN', active: 'true' };

describe('warnLoginRefused (development builds only)', () => {
  it('in a dev build warns with the reason and field TYPES, never values', () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnLoginRefused(() => diagnoseUserDoc(badDoc));
    expect(warn).toHaveBeenCalledTimes(1);
    const dump = JSON.stringify(warn.mock.calls[0]);
    expect(dump).toContain('WRONG_FIELD_TYPE');
    expect(dump).toContain('"active":"string"');
    expect(dump).not.toContain('owner@example.com');
    expect(dump).not.toContain('Gym Owner');
  });

  it.each([
    ['missing users doc', () => diagnoseUserDoc(null), 'MISSING_USER_DOC'],
    ['inactive', () => diagnoseUserDoc({ ...badDoc, active: false }), 'INACTIVE'],
    ['unknown role', () => diagnoseUserDoc({ ...badDoc, active: true, role: 'boss' }), 'UNKNOWN_ROLE'],
    ['permission denied', () => ({ reason: 'PERMISSION_DENIED' as const, fieldTypes: {} }), 'PERMISSION_DENIED'],
  ])('explains %s', (_label, diagnose, reason) => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnLoginRefused(diagnose);
    expect(String(warn.mock.calls[0]?.[0])).toContain(reason);
  });

  it('in a production build it does nothing and never even evaluates the diagnosis', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diagnose = vi.fn(() => diagnoseUserDoc(badDoc));
    warnLoginRefused(diagnose);
    expect(diagnose).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when the diagnosis says access would be granted', () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnLoginRefused(() => null);
    expect(warn).not.toHaveBeenCalled();
  });
});
