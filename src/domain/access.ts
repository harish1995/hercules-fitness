import { APP_ALLOWED_ROLES, isRole, type Role } from '../constants/roles';

/** Structural subset of UserDoc that the access decision needs (keeps this module Firebase-free). */
export interface AccessInput {
  role: unknown;
  active: unknown;
}

/**
 * Decide whether a resolved users/{uid} record may enter the application (FR-1, US-1.6).
 * Missing doc, inactive, unknown role, or a role that has no UI in this phase => denied.
 */
export function evaluateAccess(
  userDoc: AccessInput | null,
  allowedRoles: readonly Role[] = APP_ALLOWED_ROLES,
): { granted: true; role: Role } | { granted: false } {
  if (!userDoc) return { granted: false };
  if (userDoc.active !== true) return { granted: false };
  if (!isRole(userDoc.role)) return { granted: false };
  if (!allowedRoles.includes(userDoc.role)) return { granted: false };
  return { granted: true, role: userDoc.role };
}

/** The route-guard check, isolated so it can be unit-tested (US-1.6d). */
export function isRoleAllowed(role: Role | null, allow: readonly Role[]): boolean {
  return role !== null && allow.includes(role);
}

export type LoginRefusalReason =
  | 'MISSING_USER_DOC'
  | 'WRONG_FIELD_TYPE'
  | 'UNKNOWN_ROLE'
  | 'INACTIVE'
  | 'ROLE_NOT_ALLOWED'
  | 'PERMISSION_DENIED';

export interface LoginRefusalDiagnosis {
  reason: LoginRefusalReason;
  /** The JavaScript TYPE of each users/{uid} field (never a value: no email, name or role text). */
  fieldTypes: Record<string, string>;
}

/** `typeof`, but telling null, arrays and Firestore Timestamps apart. Never returns a value. */
export function fieldType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') return 'timestamp';
  return typeof value;
}

const DIAGNOSED_FIELDS = ['email', 'displayName', 'role', 'active', 'memberDocId', 'createdAt'] as const;

/**
 * Why would this raw users/{uid} data be refused? Returns null when access would be granted. Used ONLY for
 * development diagnostics (see utils/devDiagnostics.ts): it reports field TYPES, never values, so a
 * misconfigured users doc can be fixed without leaking an email or name into the console.
 */
export function diagnoseUserDoc(
  data: unknown,
  allowedRoles: readonly Role[] = APP_ALLOWED_ROLES,
): LoginRefusalDiagnosis | null {
  if (data === null || data === undefined) return { reason: 'MISSING_USER_DOC', fieldTypes: {} };
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { reason: 'WRONG_FIELD_TYPE', fieldTypes: { document: fieldType(data) } };
  }
  const d = data as Record<string, unknown>;
  const fieldTypes: Record<string, string> = {};
  for (const key of DIAGNOSED_FIELDS) fieldTypes[key] = fieldType(d[key]);

  if (
    typeof d.role !== 'string' ||
    typeof d.active !== 'boolean' ||
    typeof d.email !== 'string' ||
    typeof d.displayName !== 'string'
  ) {
    return { reason: 'WRONG_FIELD_TYPE', fieldTypes };
  }
  if (!isRole(d.role)) return { reason: 'UNKNOWN_ROLE', fieldTypes };
  if (d.active !== true) return { reason: 'INACTIVE', fieldTypes };
  if (!allowedRoles.includes(d.role)) return { reason: 'ROLE_NOT_ALLOWED', fieldTypes };
  return null;
}
