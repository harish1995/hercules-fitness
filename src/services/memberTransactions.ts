import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { CONSENT_VERSION } from '../constants/consent';
import { type Clock, istYear, systemClock, todayIstStart } from '../domain/dates';
import { changedProfileFields, memberAuditLabel, profileOfMember } from '../domain/memberDiff';
import { counterDocId, formatMemberId, nextSeq } from '../domain/memberId';
import { paymentAmountError, paymentDetailsError } from '../domain/payment';
import { buildMemberSearchFields } from '../domain/search';
import {
  type Actor,
  type DuplicateMemberInfo,
  type MemberProfileInput,
  type RegisterMemberInput,
  type UpdateMemberInput,
} from '../types/member';
import { type AssignedMembership } from '../types/membership';
import { auditDocData } from './auditService';
import { AppError, DuplicateMobileError, mapReadError } from './errors';
import { memberFromDoc, toTimestamp } from './firestoreConverters';
import { assertIstDay, buildMembership, membershipAuditData, readActivePlan } from './membershipWrite';
import { buildFirstPayment } from './paymentWrite';
import { MAX_ATTEMPTS, serializeTxError as serialize, withContentionRetry } from './txHelpers';

/**
 * Member write transactions (architecture §2.3 / §2.7). Every function takes the Firestore instance so the
 * SAME code runs in the app (memberService passes the app db) and in the emulator tests. Each is exactly ONE
 * `runTransaction`: all reads first, then all writes, with the audit record in the same commit (US-2.14b).
 *
 *   TX-1 registerMemberTx    counter +1 (naming this member), member, audit, (medical), (first membership + its audit)
 *   TX-8 updateMemberTx      member, (medical), audit; optimistic-concurrency guard
 *   TX-7 softDeleteMemberTx  member flag, audit; never a hard delete
 *
 * Duplicate mobile numbers are a WARNING (NEW-14), not a database constraint: a best-effort query before the
 * transaction asks for an explicit confirmation. Two admins registering the same new number at the same instant can
 * both pass it (US-2.3d); the number is not unique by design (families share phones).
 *
 * Nothing here logs; error objects carry no personal data.
 */

export interface RegisteredMember {
  memberDocId: string;
  memberId: string;
  /** true when this document id had already been created (double submit / retry after an unknown commit). */
  alreadyExisted: boolean;
  /** The first membership, when a plan was chosen at registration (Admin). */
  membership?: AssignedMembership;
}

/** Read the trainer for a snapshot (name) and refuse an unknown or inactive one. Runs inside a transaction. */
async function readTrainerName(tx: Transaction, db: Firestore, trainerId: string): Promise<string> {
  const snap = await tx.get(doc(db, COLLECTIONS.trainers, trainerId));
  const data = snap.data();
  if (!snap.exists() || !data) throw new AppError('NOT_FOUND', { userMessage: 'The selected trainer no longer exists.' });
  if (data.active !== true) {
    throw new AppError('INVALID_DATA', { userMessage: 'The selected trainer is inactive. Choose another trainer.' });
  }
  return typeof data.name === 'string' ? data.name : '';
}

function profileFields(profile: MemberProfileInput, trainerName: string | null) {
  const search = buildMemberSearchFields(profile);
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    displayName: search.displayName,
    gender: profile.gender,
    dateOfBirth: toTimestamp(profile.dateOfBirth),
    mobile: profile.mobile,
    email: profile.email,
    address: profile.address,
    emergencyContact: profile.emergencyContact,
    trainerId: profile.trainerId,
    trainerName: profile.trainerId === null ? null : trainerName,
    joiningDate: toTimestamp(profile.joiningDate),
    generalNotes: profile.generalNotes,
    searchFullName: search.searchFullName,
    searchReverseName: search.searchReverseName,
    searchMobile: search.searchMobile,
  };
}

/** Pre-generate the document id so a retried submit targets the same document (idempotent, US-2.1d). */
export function newMemberDocId(db: Firestore): string {
  return doc(collection(db, COLLECTIONS.members)).id;
}

// ---------------------------------------------------------------------------------------------------------------------
// Duplicate mobile (NEW-14: WARN + explicit confirm)
// ---------------------------------------------------------------------------------------------------------------------

const MAX_MOBILE_MATCHES = 6;

/**
 * Members that have this (normalized) mobile, LIVE first. An ADMIN also sees soft-deleted owners, so the warning can
 * name them as deleted (US-2.3c); Staff cannot read deleted members (rules), so their query is constrained to live ones.
 * `ignoreMemberDocId` is the member being registered / edited (never its own duplicate; also what makes a retried
 * registration idempotent). Uses only single-field / existing indexes (searchMobile, deleted+searchMobile).
 */
export async function findMembersByMobileTx(
  db: Firestore,
  mobile: string,
  role: Actor['role'],
  ignoreMemberDocId?: string,
): Promise<DuplicateMemberInfo[]> {
  try {
    const constraints =
      role === 'ADMIN'
        ? [where('searchMobile', '==', mobile), limit(MAX_MOBILE_MATCHES)]
        : [where('deleted', '==', false), where('searchMobile', '==', mobile), limit(MAX_MOBILE_MATCHES)];
    const snap = await getDocs(query(collection(db, COLLECTIONS.members), ...constraints));
    const found = snap.docs
      .filter((d) => d.id !== ignoreMemberDocId)
      .map((d): DuplicateMemberInfo => {
        const m = memberFromDoc(d.id, d.data());
        return { memberDocId: m.id, memberId: m.memberId, displayName: m.displayName, deleted: m.deleted };
      });
    return [...found.filter((m) => !m.deleted), ...found.filter((m) => m.deleted)];
  } catch (e) {
    throw mapReadError(e);
  }
}

/** The owner to name in the warning: a live member if there is one, else a deleted one, else null (the live form check). */
export async function findMemberByMobileTx(
  db: Firestore,
  mobile: string,
  role: Actor['role'],
  ignoreMemberDocId?: string,
): Promise<DuplicateMemberInfo | null> {
  return (await findMembersByMobileTx(db, mobile, role, ignoreMemberDocId))[0] ?? null;
}

/** Throws DuplicateMobileError when a LIVE member has the mobile. A soft-deleted owner never stops registration. */
async function assertMobileConfirmed(db: Firestore, mobile: string, role: Actor['role'], ignoreMemberDocId: string) {
  const owner = await findMemberByMobileTx(db, mobile, role, ignoreMemberDocId);
  if (owner && !owner.deleted) throw new DuplicateMobileError(owner);
}

export interface RegisterParams {
  db: Firestore;
  /** From `newMemberDocId`, created ONCE per form so retries are idempotent. */
  memberDocId: string;
  input: RegisterMemberInput;
  actor: Actor;
  /** A photo will be saved right after (the flag lets the profile know to look for it). */
  hasPhoto?: boolean;
  /** The user ticked "register anyway" for a mobile that another member already has (NEW-14). */
  duplicateMobileConfirmed?: boolean;
  clock?: Clock;
}

/**
 * TX-1. Allocates GYM-YYYY-NNNN from the per-year counter in the same commit that creates the member, so no
 * ID is consumed without a member and none is skipped when the commit fails (US-2.2b). The year is the IST
 * year, not the device year (US-2.2c). Two concurrent registrations contend on the counter; the rules refuse the
 * loser's stale write (permission-denied, see txHelpers), which `withContentionRetry` re-runs so it re-reads `lastSeq`
 * and takes the next number (US-2.2a). The counter also names THIS member, so one increment can only serve one member.
 *
 * An Admin may create the member's FIRST membership in the same commit (US-3.5b): the plan is read in the
 * transaction, the end date computed from the chosen start, and the member's `membership` summary, `pendingPaise`
 * (the plan price minus the optional FIRST PAYMENT), the membership document, the payment (with its own audit record) and
 * the membership's audit record commit together.
 */
export async function registerMemberTx(params: RegisterParams): Promise<RegisteredMember> {
  const { db, memberDocId, input, actor, hasPhoto = false, clock = systemClock } = params;
  const { profile } = input;
  const medical = input.medicalNotes?.trim() ? input.medicalNotes.trim() : null;
  if (medical && actor.role !== 'ADMIN') throw new AppError('PERMISSION_DENIED'); // medical notes are Admin-only
  if (!input.consentGiven) throw new AppError('INVALID_DATA', { userMessage: 'Consent is required to register a member.' });
  const choice = input.membership ?? null;
  if (choice && actor.role !== 'ADMIN') {
    throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can assign a membership plan.' });
  }
  if (choice) assertIstDay(choice.startDate);
  const firstPayment = choice?.firstPayment ?? null;
  if (firstPayment) {
    // date, method and texts are checked here; the cap (the plan price) is checked inside, against the plan read there
    const early = paymentDetailsError(firstPayment, Number.MAX_SAFE_INTEGER, todayIstStart(clock));
    if (early) throw new AppError('INVALID_DATA', { userMessage: early });
  }

  // Best-effort duplicate-mobile warning (NEW-14), before anything is written.
  if (!params.duplicateMobileConfirmed) {
    try {
      await assertMobileConfirmed(db, profile.mobile, actor.role, memberDocId);
    } catch (e) {
      throw e instanceof AppError ? e : serialize(e);
    }
  }

  const year = istYear(clock);
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const counterRef = doc(db, COLLECTIONS.counters, counterDocId(year));
  const medicalRef = doc(db, COLLECTIONS.memberMedical, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  const membershipRef = choice ? doc(collection(db, COLLECTIONS.memberships)) : null;
  const membershipAuditRef = choice ? doc(collection(db, COLLECTIONS.auditLogs)) : null;

  try {
    return await withContentionRetry(() => runTransaction(
      db,
      async (tx): Promise<RegisteredMember> => {
        // ---- READS (all before any write) ----
        const existing = await tx.get(memberRef);
        if (existing.exists()) {
          const memberId = existing.data()?.memberId;
          return { memberDocId, memberId: typeof memberId === 'string' ? memberId : '', alreadyExisted: true };
        }
        const counterSnap = await tx.get(counterRef);
        const trainerName = profile.trainerId ? await readTrainerName(tx, db, profile.trainerId) : null;
        const plan = choice ? await readActivePlan(tx, db, choice.planId) : null;

        // ---- COMPUTE ----
        const seq = nextSeq(counterSnap.data()?.lastSeq);
        const memberId = formatMemberId(year, seq);
        const displayName = buildMemberSearchFields(profile).displayName;
        const tooMuch = firstPayment && plan ? paymentAmountError(firstPayment.amountPaise, plan.pricePaise) : null;
        if (tooMuch) {
          throw new AppError('INVALID_DATA', { userMessage: tooMuch.replace(/^Amount exceeds pending balance/, 'Amount paid cannot be more than the total amount') });
        }
        const built =
          choice && plan && membershipRef && membershipAuditRef
            ? buildMembership(
                {
                  plan, start: choice.startDate, memberDocId, memberId, memberDisplayName: displayName, actor,
                  auditId: membershipAuditRef.id, paidPaise: firstPayment?.amountPaise ?? 0,
                },
                membershipRef.id,
              )
            : null;
        const payment =
          firstPayment && built && membershipRef
            ? buildFirstPayment(db, {
                membershipDocId: membershipRef.id, memberDocId, memberId, memberDisplayName: displayName,
                membershipId: membershipRef.id, details: firstPayment, actor,
              })
            : null;

        // ---- WRITES ----
        tx.set(counterRef, { year, lastSeq: seq, lastMemberDocId: memberDocId, updatedAt: serverTimestamp(), updatedBy: actor.uid });
        tx.set(memberRef, {
          memberId,
          memberIdYear: year,
          ...profileFields(profile, trainerName),
          hasPhoto,
          suspended: false,
          suspendedAt: null,
          suspendedReason: null,
          suspendedBy: null,
          deleted: false,
          deletedAt: null,
          deletedBy: null,
          hasMembership: built !== null,
          membership: built
            ? built.summary
            : { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null },
          // D-7: the dues of a new membership = its price minus the first payment taken with it (if any)
          pendingPaise: built ? built.outstandingPaise : 0,
          consent: {
            given: true,
            at: serverTimestamp(),
            byUid: actor.uid,
            byName: actor.name,
            version: CONSENT_VERSION,
            guardianConsent: input.guardianConsent,
          },
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: auditRef.id,
        });
        if (medical) {
          tx.set(medicalRef, { notes: medical, updatedAt: serverTimestamp(), updatedBy: actor.uid });
        }
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'MEMBER_CREATED',
            entity: 'member',
            entityId: memberDocId,
            entityLabel: memberAuditLabel(memberId, displayName),
            // no values: only the fact that the sections exist
            metadata: { memberId, hasPhoto, hasMedicalNotes: medical !== null, guardianConsent: input.guardianConsent },
          }),
        );
        if (built && plan && choice && membershipRef && membershipAuditRef) {
          tx.set(membershipRef, built.data);
          tx.set(
            membershipAuditRef,
            membershipAuditData(actor, 'MEMBERSHIP_CREATED', membershipRef.id, {
              memberId, memberDisplayName: displayName, plan, start: choice.startDate, end: built.end,
            }),
          );
          if (payment) {
            tx.set(payment.paymentRef, payment.paymentData);
            tx.set(payment.auditRef, payment.auditData);
          }
        }
        return {
          memberDocId,
          memberId,
          alreadyExisted: false,
          ...(built && plan && choice && membershipRef
            ? {
                membership: {
                  membershipId: membershipRef.id,
                  startDate: choice.startDate,
                  endDate: built.end,
                  planName: plan.name,
                  amountPaise: plan.pricePaise,
                  paidPaise: firstPayment?.amountPaise ?? 0,
                  alreadyExisted: false,
                },
              }
            : {}),
        };
      },
      { maxAttempts: MAX_ATTEMPTS },
    ));
  } catch (e) {
    throw serialize(e);
  }
}

export interface UpdateParams {
  db: Firestore;
  memberDocId: string;
  /** `Member.version` from when the edit form was loaded. */
  expectedVersion: string;
  /** The mobile the form loaded with: the duplicate warning only applies when the number CHANGES. */
  currentMobile: string;
  input: UpdateMemberInput;
  actor: Actor;
  /** The user ticked "save anyway" for a mobile that another member already has (NEW-14). */
  duplicateMobileConfirmed?: boolean;
}

export type UpdateResult = { changed: false } | { changed: true; changedFields: string[] };

/**
 * TX-8. Refuses (CONFLICT) when the stored record changed since the form loaded (US-2.10d). Recomputes the
 * search fields in the same write (§2.7). The audit record lists changed field NAMES only, incl. the name
 * `medicalNotes` when they changed, never their content (FR-13). Editing is Admin-only (rules enforce it).
 * A CHANGED mobile that another member already has needs the same explicit confirmation as registration (NEW-14).
 * No contention retry here: a profile edit touches only the member's own document (guarded by the version), and no rule
 * reads another document it could race on (see txHelpers).
 */
export async function updateMemberTx(params: UpdateParams): Promise<UpdateResult> {
  const { db, memberDocId, expectedVersion, input, actor } = params;
  const { profile } = input;
  if (input.medicalNotes !== undefined && actor.role !== 'ADMIN') throw new AppError('PERMISSION_DENIED');

  if (!params.duplicateMobileConfirmed && profile.mobile !== params.currentMobile) {
    await assertMobileConfirmed(db, profile.mobile, actor.role, memberDocId);
  }

  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const medicalRef = doc(db, COLLECTIONS.memberMedical, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    return await runTransaction(
      db,
      async (tx): Promise<UpdateResult> => {
        // ---- READS ----
        const snap = await tx.get(memberRef);
        const data = snap.data();
        if (!snap.exists() || !data || data.deleted === true) throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
        const before = memberFromDoc(snap.id, data);
        if (before.version !== expectedVersion) {
          throw new AppError('CONFLICT', {
            userMessage: 'This member was changed by someone else while you were editing. Reload the record and try again.',
          });
        }

        const medicalSnap = input.medicalNotes !== undefined ? await tx.get(medicalRef) : null;
        const oldMedical = medicalSnap?.exists() ? String(medicalSnap.data()?.notes ?? '') : '';
        const newMedical = input.medicalNotes?.trim() ?? '';
        const medicalChanged = input.medicalNotes !== undefined && oldMedical !== newMedical;

        const trainerChanged = before.trainerId !== profile.trainerId;
        const trainerName = trainerChanged
          ? profile.trainerId
            ? await readTrainerName(tx, db, profile.trainerId)
            : null
          : before.trainerName;

        // ---- COMPUTE ----
        const changedFields: string[] = changedProfileFields(profileOfMember(before), profile);
        if (medicalChanged) changedFields.push('medicalNotes');
        if (changedFields.length === 0) return { changed: false };
        const displayName = buildMemberSearchFields(profile).displayName;

        // ---- WRITES ----
        tx.update(memberRef, {
          ...profileFields(profile, trainerName),
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: auditRef.id,
        });
        if (medicalChanged) {
          if (newMedical === '') tx.delete(medicalRef);
          else tx.set(medicalRef, { notes: newMedical, updatedAt: serverTimestamp(), updatedBy: actor.uid });
        }
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'MEMBER_UPDATED',
            entity: 'member',
            entityId: memberDocId,
            entityLabel: memberAuditLabel(before.memberId, displayName),
            metadata: { changedFields: changedFields.join(',') },
          }),
        );
        return { changed: true, changedFields };
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serialize(e);
  }
}

export interface DeleteParams {
  db: Firestore;
  memberDocId: string;
  actor: Actor;
}

/**
 * TX-7: SOFT delete only. Flags the member deleted (hidden from every list, count and search, D-8) and writes the audit
 * record. Memberships, payments and audit history are untouched. There is no hard delete anywhere (rules forbid it).
 */
export async function softDeleteMemberTx(params: DeleteParams): Promise<void> {
  const { db, memberDocId, actor } = params;
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    await runTransaction(
      db,
      async (tx) => {
        const snap = await tx.get(memberRef);
        const data = snap.data();
        if (!snap.exists() || !data || data.deleted === true) throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
        const member = memberFromDoc(snap.id, data);

        tx.update(memberRef, {
          deleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: auditRef.id,
        });
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'MEMBER_DELETED',
            entity: 'member',
            entityId: memberDocId,
            entityLabel: memberAuditLabel(member.memberId, member.displayName),
            metadata: { soft: true },
          }),
        );
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serialize(e);
  }
}
