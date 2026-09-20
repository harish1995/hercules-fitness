import { describe, expect, it } from 'vitest';
import { buildLoginRedirect, resolveNextPath, resolvePostLoginPath } from './nextPath';

describe('resolveNextPath (US-1.5b)', () => {
  it('returns in-app paths unchanged, keeping query strings', () => {
    expect(resolveNextPath('/members')).toBe('/members');
    expect(resolveNextPath('/members?page=2')).toBe('/members?page=2');
  });

  it('falls back to the dashboard for empty/absent values', () => {
    expect(resolveNextPath(null)).toBe('/dashboard');
    expect(resolveNextPath(undefined)).toBe('/dashboard');
    expect(resolveNextPath('')).toBe('/dashboard');
  });

  it('blocks open redirects', () => {
    expect(resolveNextPath('https://evil.example')).toBe('/dashboard');
    expect(resolveNextPath('//evil.example')).toBe('/dashboard');
    expect(resolveNextPath('/\\evil.example')).toBe('/dashboard');
    expect(resolveNextPath('javascript:alert(1)')).toBe('/dashboard');
    expect(resolveNextPath('/ok\nX')).toBe('/dashboard');
  });

  it('never redirects back into the public pages or the bare root', () => {
    expect(resolveNextPath('/login')).toBe('/dashboard');
    expect(resolveNextPath('/forgot-password?x=1')).toBe('/dashboard');
    expect(resolveNextPath('/')).toBe('/dashboard');
  });
});

describe('resolvePostLoginPath (US-1.5b: requested page, or the dashboard if not permitted)', () => {
  it('returns a known, permitted route unchanged (keeping query and hash)', () => {
    expect(resolvePostLoginPath('/members', 'ADMIN')).toBe('/members');
    expect(resolvePostLoginPath('/members?page=2#top', 'ADMIN')).toBe('/members?page=2#top');
    expect(resolvePostLoginPath('/settings', 'ADMIN')).toBe('/settings');
  });

  it('falls back to the dashboard for a path that matches no known route (no 404 after login)', () => {
    expect(resolvePostLoginPath('/does-not-exist', 'ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginPath('/members/123/edit/extra', 'ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginPath('/members-evil', 'ADMIN')).toBe('/dashboard');
  });

  it('accepts the nested member routes (Phase 2), honouring their own allow lists', () => {
    expect(resolvePostLoginPath('/members/new', 'ADMIN')).toBe('/members/new');
    expect(resolvePostLoginPath('/members/abc123', 'ADMIN')).toBe('/members/abc123');
    expect(resolvePostLoginPath('/members/abc123/edit', 'ADMIN')).toBe('/members/abc123/edit');
    // editing is Admin-only
    expect(resolvePostLoginPath('/members/abc123/edit', 'STAFF')).toBe('/dashboard');
    expect(resolvePostLoginPath('/members/abc123', 'STAFF')).toBe('/members/abc123');
  });

  it('falls back to the dashboard when the role is not permitted on the route (no access-denied after login)', () => {
    const routes = [
      { path: '/dashboard', allow: ['ADMIN', 'STAFF'] as const },
      { path: '/reports', allow: ['ADMIN'] as const },
      { path: '/attendance', allow: ['ADMIN', 'STAFF'] as const },
    ];
    expect(resolvePostLoginPath('/reports', 'STAFF', routes)).toBe('/dashboard');
    expect(resolvePostLoginPath('/reports?x=1', 'MEMBER', routes)).toBe('/dashboard');
    expect(resolvePostLoginPath('/reports', null, routes)).toBe('/dashboard');
    expect(resolvePostLoginPath('/attendance', 'STAFF', routes)).toBe('/attendance');
    expect(resolvePostLoginPath('/reports', 'ADMIN', routes)).toBe('/reports');
  });

  it('still blocks open redirects and public pages', () => {
    expect(resolvePostLoginPath('//evil.example', 'ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginPath('https://evil.example/members', 'ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginPath('/login', 'ADMIN')).toBe('/dashboard');
    expect(resolvePostLoginPath(null, 'ADMIN')).toBe('/dashboard');
  });
});

describe('buildLoginRedirect', () => {
  it('remembers a protected path', () => {
    expect(buildLoginRedirect('/members?page=2', 'next')).toBe('/login?next=%2Fmembers%3Fpage%3D2');
  });
  it('omits next for the dashboard/root', () => {
    expect(buildLoginRedirect('/', 'next')).toBe('/login');
    expect(buildLoginRedirect('/dashboard', 'next')).toBe('/login');
  });
});
