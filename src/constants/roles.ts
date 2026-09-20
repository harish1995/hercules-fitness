export const ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Roles that may enter the application in the CURRENT phase (architecture §4.1).
 * Phase 1 admits ADMIN only; STAFF/MEMBER have no UI yet. Adding STAFF later is a
 * one-line change here.
 */
export const APP_ALLOWED_ROLES: readonly Role[] = ['ADMIN'];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  STAFF: 'Staff',
  MEMBER: 'Member',
};
