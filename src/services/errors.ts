/**
 * Friendly error mapping (NFR-4, US-1.10a). Raw Firebase codes and messages are NEVER shown to
 * the user: they are reduced to an AppErrorKind plus a fixed, user-safe message. This module is
 * pure (no Firebase import) so it can be unit-tested without mocks.
 */
import { warnFirestoreLoadFailure } from '../utils/devDiagnostics';

export type AppErrorKind =
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_REQUESTS'
  | 'NETWORK'
  | 'UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'INDEX_REQUIRED'
  | 'INVALID_DATA'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'UPLOAD'
  | 'PAYMENT'
  | 'UNKNOWN';

export const ERROR_MESSAGES: Record<AppErrorKind, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  TOO_MANY_REQUESTS: 'Too many attempts. Please try again later or reset your password.',
  NETWORK: 'Network error. Check your internet connection and try again.',
  UNAVAILABLE: 'The service is temporarily unavailable. Please try again in a moment.',
  PERMISSION_DENIED: 'You do not have permission to do that.',
  INDEX_REQUIRED: 'This view needs a database index that is still being built. Try again in a few minutes.',
  INVALID_DATA: 'Some of the information provided is invalid. Please review it and try again.',
  DUPLICATE: 'This record already exists.',
  CONFLICT: 'This record was changed by someone else. Reload it and try again.',
  NOT_FOUND: 'The requested record could not be found.',
  UPLOAD: 'The upload failed. Please try again.',
  PAYMENT: 'The payment could not be recorded. Please check the details and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export class AppError extends Error {
  readonly kind: AppErrorKind;
  /** Safe to render. Never contains a Firebase code or stack. */
  readonly userMessage: string;

  constructor(kind: AppErrorKind, options?: { cause?: unknown; userMessage?: string }) {
    super(`AppError:${kind}`, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.userMessage = options?.userMessage ?? ERROR_MESSAGES[kind];
  }
}

const CODE_TO_KIND: Record<string, AppErrorKind> = {
  // Authentication. Wrong password, unknown email and malformed email are deliberately one
  // kind so the UI cannot reveal which one was wrong (US-1.1b). A disabled account is folded in
  // too: a distinct message would confirm the account exists.
  'auth/invalid-credential': 'INVALID_CREDENTIALS',
  'auth/wrong-password': 'INVALID_CREDENTIALS',
  'auth/user-not-found': 'INVALID_CREDENTIALS',
  'auth/invalid-email': 'INVALID_CREDENTIALS',
  'auth/missing-password': 'INVALID_CREDENTIALS',
  'auth/invalid-login-credentials': 'INVALID_CREDENTIALS',
  'auth/user-disabled': 'INVALID_CREDENTIALS',
  'auth/too-many-requests': 'TOO_MANY_REQUESTS',
  'auth/network-request-failed': 'NETWORK',
  'auth/internal-error': 'UNAVAILABLE',
  'auth/timeout': 'NETWORK',
  'auth/web-storage-unsupported': 'UNAVAILABLE',
  'auth/operation-not-allowed': 'UNAVAILABLE',
  'auth/unauthorized-domain': 'UNAVAILABLE',
  'auth/invalid-api-key': 'UNAVAILABLE',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'UNAVAILABLE',

  // Firestore (gRPC status codes, as surfaced by the JS SDK)
  unavailable: 'UNAVAILABLE',
  'deadline-exceeded': 'NETWORK',
  'resource-exhausted': 'UNAVAILABLE',
  internal: 'UNAVAILABLE',
  'permission-denied': 'PERMISSION_DENIED',
  unauthenticated: 'PERMISSION_DENIED',
  'invalid-argument': 'INVALID_DATA',
  'failed-precondition': 'INVALID_DATA',
  'out-of-range': 'INVALID_DATA',
  'already-exists': 'DUPLICATE',
  aborted: 'CONFLICT',
  'not-found': 'NOT_FOUND',
};

/** Extract a string `code` from an unknown thrown value (FirebaseError shape), or undefined. */
export function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code.replace(/^firestore\//, '');
  }
  return undefined;
}

/** Map an unknown thrown value (or a bare code string) to an AppError. AppErrors pass through. */
export function mapFirebaseError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = typeof error === 'string' ? error.replace(/^firestore\//, '') : getErrorCode(error);
  const kind = (code !== undefined ? CODE_TO_KIND[code] : undefined) ?? 'UNKNOWN';
  return new AppError(kind, { cause: error });
}

/** Shown when a LOAD (list / dashboard / profile) is refused by the security rules. */
export const VIEW_DENIED_MESSAGE = 'You do not have permission to view this.';

/**
 * Map an error thrown by a READ (list, dashboard, profile, history) to an AppError. Unlike `mapFirebaseError` (used for
 * writes, where `failed-precondition` means a rejected commit), on a query `failed-precondition` means the composite
 * index is missing or still building, and `permission-denied` means the rules refused a view, so each gets its own
 * message. In development only (`import.meta.env.DEV`) the Firebase error CODE, and for a missing index the console
 * link that creates it, is written to the browser console; the UI never shows raw codes or links (NFR-4).
 */
export function mapReadError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = typeof error === 'string' ? error.replace(/^firestore\//, '') : getErrorCode(error);
  warnFirestoreLoadFailure(code, typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined);
  if (code === 'failed-precondition') return new AppError('INDEX_REQUIRED', { cause: error });
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return new AppError('PERMISSION_DENIED', { cause: error, userMessage: VIEW_DENIED_MESSAGE });
  }
  return mapFirebaseError(error);
}

/** Message safe to show to the user for any thrown value. */
export function toUserMessage(error: unknown): string {
  return mapFirebaseError(error).userMessage;
}

/** True for "try again, the connection/service is the problem" failures (retryable UI). */
export function isTransientError(error: unknown): boolean {
  const { kind } = mapFirebaseError(error);
  return kind === 'NETWORK' || kind === 'UNAVAILABLE';
}

/**
 * Another member already has this mobile number (NEW-14: duplicate mobile is a WARNING that needs an explicit
 * "register anyway" confirmation, never a hard block: families share phones). Carries who, so the UI can name and link them.
 */
export class DuplicateMobileError extends AppError {
  readonly existing: { memberDocId: string; memberId: string; displayName: string; deleted: boolean } | null;

  constructor(existing: DuplicateMobileError['existing']) {
    super('DUPLICATE', {
      userMessage: existing
        ? `This mobile number is already registered to ${existing.displayName} (${existing.memberId}). Confirm to continue anyway.`
        : 'This mobile number is already registered to another member. Confirm to continue anyway.',
    });
    this.name = 'DuplicateMobileError';
    this.existing = existing;
  }
}

/** Why an attendance action was refused (the UI reacts to NEEDS_CONFIRMATION; every reason has a user-safe message). */
export type AttendanceRefusalReason =
  | 'NEEDS_CONFIRMATION'
  | 'SUSPENDED'
  | 'MEMBER_NOT_FOUND'
  | 'ALREADY_CHECKED_IN'
  | 'ALREADY_RECORDED'
  | 'NO_CHECK_IN'
  | 'ALREADY_CHECKED_OUT';

/**
 * An attendance check-in / check-out / absent mark that the business rules refuse (NEW-12, US-5.1b, US-5.2). It is a normal
 * outcome, not a failure: nothing was written. `reason` lets the UI ask for the confirmation the rule needs.
 */
export class AttendanceRefusalError extends AppError {
  readonly reason: AttendanceRefusalReason;

  constructor(reason: AttendanceRefusalReason, userMessage: string) {
    super(reason === 'SUSPENDED' ? 'PERMISSION_DENIED' : reason === 'MEMBER_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_DATA', { userMessage });
    this.name = 'AttendanceRefusalError';
    this.reason = reason;
  }
}
