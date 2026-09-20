import { type LoginRefusalDiagnosis, type LoginRefusalReason } from '../domain/access';

const HINTS: Record<LoginRefusalReason, string> = {
  MISSING_USER_DOC: 'There is no users/{uid} document for this Auth user. Create it in the Firestore console (README section 5).',
  WRONG_FIELD_TYPE:
    'A users/{uid} field has the wrong type. Expected: email string, displayName string, role string, active boolean.',
  UNKNOWN_ROLE: 'users/{uid}.role is not one of ADMIN, STAFF, MEMBER (exact, upper-case).',
  INACTIVE: 'users/{uid}.active is not true.',
  ROLE_NOT_ALLOWED: 'This role has no UI in the current phase (only ADMIN can enter the app).',
  PERMISSION_DENIED: 'Firestore rules refused the read of users/{uid}. Deploy the current firestore.rules.',
};

/**
 * Development-only explanation of a refused login. `import.meta.env.DEV` is a compile-time constant, so in a
 * production build this function is empty and the diagnosis thunk is never evaluated: production behaviour
 * (the generic "no access" screen) is unchanged. Logs the REASON and field TYPES only, never values.
 */
export function warnLoginRefused(diagnose: () => LoginRefusalDiagnosis | null): void {
  if (!import.meta.env.DEV) return;
  const diagnosis = diagnose();
  if (!diagnosis) return;
  console.warn(`[auth] Login refused: ${diagnosis.reason}. ${HINTS[diagnosis.reason]}`, {
    fieldTypes: diagnosis.fieldTypes,
  });
}

/** The Firebase-console link that creates a missing composite index, if the SDK put one in the error message. */
export function extractIndexLink(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = /https:\/\/console\.firebase\.google\.com\/[^\s"'<>)]+/.exec(message);
  return m ? m[0] : null;
}

/**
 * Development-only breadcrumb for a failed READ: the Firebase error CODE (never the message text, which can name
 * documents) and, for `failed-precondition` (a missing / still-building composite index), the console link that
 * creates the index. Compile-time no-op in a production build; nothing here is ever shown in the UI.
 */
export function warnFirestoreLoadFailure(code: string | undefined, message: unknown): void {
  if (!import.meta.env.DEV) return;
  const link = code === 'failed-precondition' ? extractIndexLink(message) : null;
  console.warn(
    `[firestore] A load failed with code "${code ?? 'unknown'}".` +
      (code === 'failed-precondition' ? ' A composite index is probably missing or still building (README, troubleshooting).' : ''),
    ...(link ? [{ createIndexLink: link }] : []),
  );
}
