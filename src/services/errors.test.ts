import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_MESSAGES,
  getErrorCode,
  isTransientError,
  mapFirebaseError,
  toUserMessage,
} from './errors';

const fbError = (code: string, message = 'Firebase: Error raw internal text (' + code + ').') =>
  Object.assign(new Error(message), { code, name: 'FirebaseError' });

describe('mapFirebaseError', () => {
  it.each([
    ['auth/invalid-credential', 'INVALID_CREDENTIALS'],
    ['auth/wrong-password', 'INVALID_CREDENTIALS'],
    ['auth/user-not-found', 'INVALID_CREDENTIALS'],
    ['auth/invalid-email', 'INVALID_CREDENTIALS'],
    ['auth/user-disabled', 'INVALID_CREDENTIALS'],
    ['auth/too-many-requests', 'TOO_MANY_REQUESTS'],
    ['auth/network-request-failed', 'NETWORK'],
    ['auth/internal-error', 'UNAVAILABLE'],
    ['unavailable', 'UNAVAILABLE'],
    ['deadline-exceeded', 'NETWORK'],
    ['permission-denied', 'PERMISSION_DENIED'],
    ['invalid-argument', 'INVALID_DATA'],
    ['already-exists', 'DUPLICATE'],
    ['aborted', 'CONFLICT'],
    ['not-found', 'NOT_FOUND'],
  ] as const)('maps %s to %s', (code, kind) => {
    expect(mapFirebaseError(fbError(code)).kind).toBe(kind);
  });

  it('accepts the firestore/ prefixed form and bare code strings', () => {
    expect(mapFirebaseError(fbError('firestore/permission-denied')).kind).toBe('PERMISSION_DENIED');
    expect(mapFirebaseError('unavailable').kind).toBe('UNAVAILABLE');
  });

  it('maps unknown codes and non-error values to UNKNOWN', () => {
    expect(mapFirebaseError(fbError('auth/some-new-code')).kind).toBe('UNKNOWN');
    expect(mapFirebaseError(new Error('boom')).kind).toBe('UNKNOWN');
    expect(mapFirebaseError(undefined).kind).toBe('UNKNOWN');
    expect(mapFirebaseError(null).kind).toBe('UNKNOWN');
    expect(mapFirebaseError(42).kind).toBe('UNKNOWN');
  });

  it('passes an existing AppError through unchanged', () => {
    const original = new AppError('DUPLICATE');
    expect(mapFirebaseError(original)).toBe(original);
  });

  it('gives wrong password and unknown email the identical message (US-1.1b)', () => {
    expect(toUserMessage(fbError('auth/wrong-password'))).toBe(toUserMessage(fbError('auth/user-not-found')));
    expect(toUserMessage(fbError('auth/invalid-credential'))).toBe('Invalid email or password.');
  });

  it('gives a disabled account the same message as a wrong password, so login does not reveal it exists (L3)', () => {
    expect(toUserMessage(fbError('auth/user-disabled'))).toBe(toUserMessage(fbError('auth/wrong-password')));
    expect(toUserMessage(fbError('auth/user-disabled'))).toBe('Invalid email or password.');
    expect(mapFirebaseError(fbError('auth/user-disabled')).kind).not.toBe('PERMISSION_DENIED');
  });
});

describe('friendly messages never leak raw Firebase details (US-1.10a)', () => {
  const codes = [
    'auth/invalid-credential',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'permission-denied',
    'unavailable',
    'invalid-argument',
    'already-exists',
    'auth/totally-unknown',
  ];

  it.each(codes)('user message for %s contains no code or Firebase text', (code) => {
    const message = toUserMessage(fbError(code, `Firebase: secret stack detail at 0xDEADBEEF (${code})`));
    // (plain gRPC codes like "unavailable" are ordinary English words, so only the hyphenated/prefixed forms are checked verbatim)
    if (code.includes('/') || code.includes('-')) expect(message).not.toContain(code);
    expect(message).not.toMatch(/firebase/i);
    expect(message).not.toContain('0xDEADBEEF');
    expect(message).not.toContain('auth/');
  });

  it('every kind has a non-empty message without raw-code patterns', () => {
    for (const message of Object.values(ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/auth\/|firebase|firestore/i);
    }
  });

  it('too-many-requests message points to retry later or reset (US-1.1d)', () => {
    expect(toUserMessage(fbError('auth/too-many-requests'))).toMatch(/try again later|reset your password/i);
  });

  it('network message tells the user to check the connection (US-1.1e)', () => {
    expect(toUserMessage(fbError('auth/network-request-failed'))).toMatch(/network|connection/i);
  });
});

describe('helpers', () => {
  it('getErrorCode extracts string codes only', () => {
    expect(getErrorCode(fbError('auth/x'))).toBe('auth/x');
    expect(getErrorCode({ code: 12 })).toBeUndefined();
    expect(getErrorCode('nope')).toBeUndefined();
  });

  it('isTransientError is true only for network/unavailable failures', () => {
    expect(isTransientError(fbError('unavailable'))).toBe(true);
    expect(isTransientError(fbError('auth/network-request-failed'))).toBe(true);
    expect(isTransientError(fbError('permission-denied'))).toBe(false);
    expect(isTransientError(fbError('auth/invalid-credential'))).toBe(false);
  });
});
