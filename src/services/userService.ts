import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { isRole } from '../constants/roles';
import { diagnoseUserDoc } from '../domain/access';
import { db } from '../firebase/app';
import { type UserDoc } from '../types';
import { warnLoginRefused } from '../utils/devDiagnostics';
import { mapFirebaseError } from './errors';

/**
 * Defensive parse of a raw users/{uid} document. Returns null when the shape is not usable
 * (missing fields, unknown role): callers treat null exactly like "no users doc" => no access.
 */
export function parseUserDoc(data: unknown): UserDoc | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!isRole(d.role)) return null;
  if (typeof d.active !== 'boolean') return null;
  if (typeof d.email !== 'string' || typeof d.displayName !== 'string') return null;
  const memberDocId = typeof d.memberDocId === 'string' ? d.memberDocId : undefined;
  return {
    email: d.email,
    displayName: d.displayName,
    role: d.role,
    active: d.active,
    ...(memberDocId !== undefined ? { memberDocId } : {}),
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date(0),
  };
}

/**
 * Read users/{uid} ONCE. Resolves null for a missing or malformed doc. Throws AppError for
 * failures: PERMISSION_DENIED (rules refused) vs NETWORK/UNAVAILABLE (retryable) are told apart
 * by the caller via `kind` (architecture §4.1).
 */
export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
    if (!snap.exists()) {
      warnLoginRefused(() => diagnoseUserDoc(null));
      return null;
    }
    const parsed = parseUserDoc(snap.data());
    if (!parsed) warnLoginRefused(() => diagnoseUserDoc(snap.data()));
    return parsed;
  } catch (e) {
    throw mapFirebaseError(e);
  }
}
