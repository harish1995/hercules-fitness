import { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { normalizeText } from '../domain/search';
import { type Plan } from '../types/membership';
import { mapReadError } from './errors';
import { planFromDoc } from './firestoreConverters';

/** Read paths for membershipPlans (all take `db`, so the emulator tests and the seed run the same code). */

/** A gym has a handful of plans; the cap only stops a runaway collection from being read in full. */
export const MAX_PLANS = 200;

export async function listPlansFor(db: Firestore): Promise<Plan[]> {
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.membershipPlans), orderBy('name'), limit(MAX_PLANS)));
    return snap.docs.map((d) => planFromDoc(d.id, d.data()));
  } catch (e) {
    throw mapReadError(e);
  }
}

/** Is another plan (not `ignorePlanId`) already using this name, case-insensitively? Best-effort pre-check (FR-3). */
export async function planNameTaken(db: Firestore, name: string, ignorePlanId?: string): Promise<boolean> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.membershipPlans), where('nameLower', '==', normalizeText(name)), limit(2)),
    );
    return snap.docs.some((d) => d.id !== ignorePlanId);
  } catch (e) {
    throw mapReadError(e);
  }
}

/**
 * How many memberships reference this plan, INCLUDING those of soft-deleted members (memberships carry no deleted flag,
 * and the plan may only be deleted when this is 0, US-3.3b). One aggregation on an automatic single-field index.
 */
export async function countMembershipsOfPlan(db: Firestore, planId: string): Promise<number> {
  try {
    const snap = await getCountFromServer(query(collection(db, COLLECTIONS.memberships), where('planId', '==', planId)));
    return snap.data().count;
  } catch (e) {
    throw mapReadError(e);
  }
}

export const planRef = (db: Firestore, planId: string) => doc(db, COLLECTIONS.membershipPlans, planId);
