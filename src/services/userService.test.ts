import { Timestamp } from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';

// The service module imports the initialised Firebase app; the pure parser needs none of it.
vi.mock('../firebase/app', () => ({ db: {}, auth: {} }));

import { parseUserDoc } from './userService';

const base = { email: 'a@example.com', displayName: 'Owner', role: 'ADMIN', active: true };

describe('parseUserDoc', () => {
  it('parses a valid ADMIN doc', () => {
    const createdAt = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
    const doc = parseUserDoc({ ...base, createdAt });
    expect(doc).toMatchObject({ email: 'a@example.com', role: 'ADMIN', active: true });
    expect(doc?.createdAt).toBeInstanceOf(Date);
    expect(doc?.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to the epoch Date when createdAt is missing or not a Timestamp', () => {
    expect(parseUserDoc(base)?.createdAt.getTime()).toBe(0);
    expect(parseUserDoc({ ...base, createdAt: '2026-01-01' })?.createdAt.getTime()).toBe(0);
  });

  it('keeps memberDocId only when it is a string', () => {
    expect(parseUserDoc({ ...base, role: 'MEMBER', memberDocId: 'mem1' })?.memberDocId).toBe('mem1');
    expect(parseUserDoc({ ...base, memberDocId: 5 })).not.toHaveProperty('memberDocId');
  });

  it.each([
    ['null', null],
    ['non-object', 'ADMIN'],
    ['unknown role', { ...base, role: 'OWNER' }],
    ['lowercase role', { ...base, role: 'admin' }],
    ['missing role', { ...base, role: undefined }],
    ['non-boolean active', { ...base, active: 'true' }],
    ['missing active', { ...base, active: undefined }],
    ['missing email', { ...base, email: undefined }],
    ['missing displayName', { ...base, displayName: undefined }],
  ])('returns null for %s (treated as "no access")', (_label, data) => {
    expect(parseUserDoc(data)).toBeNull();
  });
});
