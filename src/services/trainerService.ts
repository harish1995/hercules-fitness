import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { db } from '../firebase/app';
import { type Trainer, type TrainerInput } from '../types/member';
import { AppError, mapFirebaseError, mapReadError } from './errors';
import { trainerFromDoc } from './firestoreConverters';

/** Trainers: simple Admin CRUD (NEW-2). Reads are open to any signed-in role with access; writes are Admin-only (rules). */

const MAX_TRAINERS = 200;

export async function listTrainers(): Promise<Trainer[]> {
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.trainers), orderBy('name'), limit(MAX_TRAINERS)));
    return snap.docs.map((d) => trainerFromDoc(d.id, d.data()));
  } catch (e) {
    throw mapReadError(e);
  }
}

export async function createTrainer(input: TrainerInput, actorUid: string): Promise<void> {
  try {
    await addDoc(collection(db, COLLECTIONS.trainers), {
      name: input.name,
      mobile: input.mobile,
      active: input.active,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

export async function updateTrainer(trainerId: string, input: TrainerInput, actorUid: string): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTIONS.trainers, trainerId), {
      name: input.name,
      mobile: input.mobile,
      active: input.active,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

/**
 * Delete only when no member (including a soft-deleted one) is assigned (US-2.13b); otherwise the trainer must be
 * deactivated. The check is a client-side count (rules cannot query). The residual race is benign: members snapshot
 * `trainerName`, so a dangling `trainerId` never breaks display.
 */
export async function deleteTrainer(trainerId: string): Promise<void> {
  try {
    const assigned = await getCountFromServer(
      query(collection(db, COLLECTIONS.members), where('trainerId', '==', trainerId)),
    );
    if (assigned.data().count > 0) {
      throw new AppError('INVALID_DATA', {
        userMessage: 'This trainer is assigned to members and cannot be deleted. Deactivate the trainer instead.',
      });
    }
    await deleteDoc(doc(db, COLLECTIONS.trainers, trainerId));
  } catch (e) {
    throw mapFirebaseError(e);
  }
}
