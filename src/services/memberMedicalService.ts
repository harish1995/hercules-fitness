import { doc, getDoc } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { db } from '../firebase/app';
import { type MemberMedical } from '../types/member';
import { mapReadError } from './errors';
import { medicalFromDoc } from './firestoreConverters';

/**
 * memberMedical/{memberDocId}: Admin-only health notes in their own document (§2.4). Only the Admin profile /
 * edit screens call this, and only for ADMIN; for anyone else the rules deny the read outright. Writes happen
 * inside the member transactions (register / update) so they are atomic with the audit record.
 */
export async function getMemberMedical(memberDocId: string): Promise<MemberMedical | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.memberMedical, memberDocId));
    const data = snap.data();
    return snap.exists() && data ? medicalFromDoc(data) : null;
  } catch (e) {
    throw mapReadError(e);
  }
}
