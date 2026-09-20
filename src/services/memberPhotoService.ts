import { collection, doc, getDoc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { memberAuditLabel } from '../domain/memberDiff';
import { PHOTO_MAX_DATAURL_CHARS, PHOTO_MAX_OUTPUT_BYTES } from '../domain/photo';
import { db } from '../firebase/app';
import { type Actor, type Member, type MemberPhoto } from '../types/member';
import { auditDocData } from './auditService';
import { AppError, mapReadError } from './errors';
import { photoFromDoc } from './firestoreConverters';
import { MAX_ATTEMPTS, serializeTxError } from './txHelpers';

/** memberPhotos/{memberDocId}: one compressed image per member, in its own doc so list reads stay small (§2.5). */

type PhotoMember = Pick<Member, 'id' | 'memberId' | 'displayName' | 'hasPhoto'>;

/** null when the member has no photo document. */
export async function getMemberPhoto(memberDocId: string): Promise<MemberPhoto | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.memberPhotos, memberDocId));
    const data = snap.data();
    return snap.exists() && data ? photoFromDoc(data) : null;
  } catch (e) {
    throw mapReadError(e);
  }
}

/** The audit record of a photo change: the FACT that the photo was added / removed, never its content. */
function photoAudit(actor: Actor, member: PhotoMember, what: 'added' | 'removed') {
  return auditDocData(actor, {
    action: 'MEMBER_UPDATED',
    entity: 'member',
    entityId: member.id,
    entityLabel: memberAuditLabel(member.memberId, member.displayName),
    metadata: { changedFields: `photo (${what})` },
  });
}

/**
 * Save (or, for Admin, replace) the photo. Deliberately NOT part of the registration transaction (US-2.5d): if
 * this fails the member already exists and the profile offers a retry. Staff may create a photo but not replace
 * one (rules); an Admin saving the FIRST photo also raises the member's `hasPhoto` flag in the same batch, together
 * with its audit record (every member update writes a new `lastAuditId`).
 */
export async function saveMemberPhoto(params: {
  member: PhotoMember;
  photo: MemberPhoto;
  actor: Actor;
}): Promise<void> {
  const { member, photo, actor } = params;
  if (photo.bytes > PHOTO_MAX_OUTPUT_BYTES || photo.dataUrl.length > PHOTO_MAX_DATAURL_CHARS) {
    throw new AppError('UPLOAD', { userMessage: 'The photo is too large to store.' });
  }
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTIONS.memberPhotos, member.id), {
      dataUrl: photo.dataUrl,
      contentType: photo.contentType,
      bytes: photo.bytes,
      width: photo.width,
      height: photo.height,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    if (!member.hasPhoto && actor.role === 'ADMIN') {
      const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
      batch.update(doc(db, COLLECTIONS.members, member.id), {
        hasPhoto: true,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
        lastAuditId: auditRef.id,
      });
      batch.set(auditRef, photoAudit(actor, member, 'added'));
    }
    await batch.commit();
  } catch (e) {
    const mapped = serializeTxError(e);
    throw mapped.kind === 'PERMISSION_DENIED' || mapped.kind === 'UNKNOWN'
      ? new AppError('UPLOAD', { cause: e })
      : mapped;
  }
}

/**
 * Remove the photo (Admin only): the photo document is deleted and `hasPhoto` cleared in ONE transaction, with an audit
 * record (US-2.5f is "one photo per member"; removal is the inverse). Idempotent when the photo is already gone.
 */
export async function removeMemberPhoto(params: { memberDocId: string; actor: Actor }): Promise<void> {
  const { memberDocId, actor } = params;
  if (actor.role !== 'ADMIN') throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can remove a photo.' });
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const photoRef = doc(db, COLLECTIONS.memberPhotos, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  try {
    await runTransaction(
      db,
      async (tx) => {
        const memberSnap = await tx.get(memberRef);
        const data = memberSnap.data();
        if (!memberSnap.exists() || !data || data.deleted === true) throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
        const photoSnap = await tx.get(photoRef);
        if (!photoSnap.exists() && data.hasPhoto !== true) return; // nothing to remove
        tx.delete(photoRef);
        tx.update(memberRef, { hasPhoto: false, updatedAt: serverTimestamp(), updatedBy: actor.uid, lastAuditId: auditRef.id });
        tx.set(
          auditRef,
          photoAudit(actor, {
            id: memberDocId,
            memberId: typeof data.memberId === 'string' ? data.memberId : '',
            displayName: typeof data.displayName === 'string' ? data.displayName : '',
            hasPhoto: true,
          }, 'removed'),
        );
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}
