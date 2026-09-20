import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { systemClock, todayIstStart, type Clock } from '../domain/dates';
import { memberAuditLabel } from '../domain/memberDiff';
import { addPaise, paise } from '../domain/money';
import { paymentAmountError, paymentDetailsError } from '../domain/payment';
import { computeRenewalStart } from '../domain/renewal';
import { type Actor } from '../types/member';
import { type AssignedMembership } from '../types/membership';
import { type PaymentDetails } from '../types/payment';
import { auditDocData } from './auditService';
import { AppError } from './errors';
import { membershipFromDoc, memberFromDoc } from './firestoreConverters';
import { assertIstDay, buildMembership, membershipAuditData, readActivePlan } from './membershipWrite';
import { buildFirstPayment } from './paymentWrite';
import { MAX_ATTEMPTS, serializeTxError, withContentionRetry } from './txHelpers';

/**
 * Membership write transactions (architecture §2.7):
 *
 *   TX-2 assignMembershipTx   first membership of a member with none (start chosen, default today)
 *   TX-3 renewMembershipTx    a NEW membership; start = latest end + 1 day, or today if that has passed
 *   TX-6 setSuspendedTx       suspend / reactivate: a member-level flag, dates untouched (Q3)
 *
 * Each is exactly ONE transaction: all reads first, then the membership document, the member's denormalized summary
 * (`membership.*`, `hasMembership`, `pendingPaise`) and the audit record commit together or not at all (US-3.7c). An
 * optional FIRST PAYMENT (Admin, US-4.2c) is written in the same commit: the payment, its audit record, the membership's
 * paid / outstanding and `pendingPaise += price - paid`. A
 * historical membership is NEVER overwritten (the rules refuse any update or delete of `memberships`). The dates are
 * computed INSIDE the transaction from the freshly read latest end date and the clock at that moment, never from what a
 * dialog showed when it opened (US-3.6f, US-3.7a). The membership id is pre-generated once per dialog, so a double
 * click or a retry after a commit that actually succeeded creates only one membership (US-3.7b).
 *
 * Admin only (matrix: assign / renew / suspend involve money or entitlement). Nothing here logs.
 */

/** Pre-generate the membership document id (create it ONCE per dialog so retries are idempotent). */
export function newMembershipDocId(db: Firestore): string {
  return doc(collection(db, COLLECTIONS.memberships)).id;
}

interface CreateParams {
  db: Firestore;
  memberDocId: string;
  planId: string;
  /** From `newMembershipDocId`, created once per dialog. */
  membershipDocId: string;
  actor: Actor;
  /** Optional money received together with the membership (Amount Paid > 0 on the form). Its id is derived from `membershipDocId`. */
  firstPayment?: PaymentDetails;
  clock?: Clock;
}

export interface AssignParams extends CreateParams {
  /** 00:00 IST of the chosen start day (any day is accepted, NEW-5). */
  startDate: Date;
}
export type RenewParams = CreateParams;

async function createMembershipTx(
  params: CreateParams & { mode: 'assign' | 'renew'; startDate?: Date },
): Promise<AssignedMembership> {
  const { db, memberDocId, planId, membershipDocId, actor, mode, firstPayment, clock = systemClock } = params;
  if (actor.role !== 'ADMIN') {
    throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can assign or renew a membership.' });
  }
  if (firstPayment) {
    // date, method and texts are checked here; the cap (the plan price) is checked inside, against the plan read there
    const early = paymentDetailsError(firstPayment, Number.MAX_SAFE_INTEGER, todayIstStart(clock));
    if (early) throw new AppError('INVALID_DATA', { userMessage: early });
  }
  if (mode === 'assign') {
    if (!params.startDate) throw new AppError('INVALID_DATA', { userMessage: 'Choose a start date.' });
    assertIstDay(params.startDate);
  }

  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const membershipRef = doc(db, COLLECTIONS.memberships, membershipDocId);
  // ONE audit record serves both documents: membership.lastAuditId and member.lastAuditId
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    return await withContentionRetry(() =>
      runTransaction(
        db,
        async (tx): Promise<AssignedMembership> => {
          // ---- READS (all before any write) ----
          const memberSnap = await tx.get(memberRef);
          const memberData = memberSnap.data();
          if (!memberSnap.exists() || !memberData || memberData.deleted === true) {
            throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
          }
          const already = await tx.get(membershipRef);
          const alreadyData = already.data();
          if (already.exists() && alreadyData) {
            // a retry / double submit of a commit that already succeeded: report it, write nothing
            const m = membershipFromDoc(already.id, alreadyData);
            return {
              membershipId: m.id, startDate: m.startDate, endDate: m.endDate, planName: m.planName, amountPaise: m.amountPaise,
              paidPaise: m.paidPaise, alreadyExisted: true,
            };
          }
          const member = memberFromDoc(memberSnap.id, memberData);
          if (member.suspended) {
            // NEW-7: renewal is blocked while suspended, until reactivated
            throw new AppError('INVALID_DATA', { userMessage: 'This member is suspended. Reactivate the member first.' });
          }
          if (mode === 'assign' && member.hasMembership) {
            throw new AppError('INVALID_DATA', { userMessage: 'This member already has a membership. Renew it instead.' });
          }
          if (mode === 'renew' && !member.hasMembership) {
            throw new AppError('INVALID_DATA', { userMessage: 'This member has no membership yet. Assign a plan first.' });
          }
          const plan = await readActivePlan(tx, db, planId);

          // ---- COMPUTE (from the FRESHLY read latest end date and the clock NOW) ----
          const start =
            mode === 'assign' && params.startDate
              ? params.startDate
              : computeRenewalStart(member.membership.endDate, todayIstStart(clock));
          const tooMuch = firstPayment ? paymentAmountError(firstPayment.amountPaise, plan.pricePaise) : null;
          if (tooMuch) {
            throw new AppError('INVALID_DATA', { userMessage: tooMuch.replace(/^Amount exceeds pending balance/, 'Amount paid cannot be more than the total amount') });
          }
          const built = buildMembership(
            {
              plan, start, memberDocId, memberId: member.memberId, memberDisplayName: member.displayName,
              actor, auditId: auditRef.id, paidPaise: firstPayment?.amountPaise ?? 0,
            },
            membershipRef.id,
          );
          const pending = addPaise(paise(member.pendingPaise), paise(built.outstandingPaise));
          const payment = firstPayment
            ? buildFirstPayment(db, {
                membershipDocId, memberDocId, memberId: member.memberId, memberDisplayName: member.displayName,
                membershipId: membershipRef.id, details: firstPayment, actor,
              })
            : null;

          // ---- WRITES ----
          tx.set(membershipRef, built.data);
          tx.update(memberRef, {
            hasMembership: true,
            membership: built.summary,
            pendingPaise: pending,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: auditRef.id,
          });
          tx.set(
            auditRef,
            membershipAuditData(actor, mode === 'assign' ? 'MEMBERSHIP_CREATED' : 'MEMBERSHIP_RENEWED', membershipRef.id, {
              memberId: member.memberId, memberDisplayName: member.displayName, plan, start, end: built.end,
            }),
          );
          if (payment) {
            tx.set(payment.paymentRef, payment.paymentData);
            tx.set(payment.auditRef, payment.auditData);
          }
          return {
            membershipId: membershipRef.id, startDate: start, endDate: built.end, planName: plan.name,
            amountPaise: plan.pricePaise, paidPaise: firstPayment?.amountPaise ?? 0, alreadyExisted: false,
          };
        },
        { maxAttempts: MAX_ATTEMPTS },
      ),
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}

/** TX-2: give a member with no membership their first one (US-3.5a). */
export function assignMembershipTx(params: AssignParams): Promise<AssignedMembership> {
  return createMembershipTx({ ...params, mode: 'assign' });
}

/** TX-3: renew (US-3.6). Early renewals stack; an expired member restarts today. Blocked while suspended or deleted. */
export function renewMembershipTx(params: RenewParams): Promise<AssignedMembership> {
  return createMembershipTx({ ...params, mode: 'renew' });
}

// ---------------------------------------------------------------------------------------------------------------------

export const SUSPEND_REASON_MAX = 200;

export interface SuspendParams {
  db: Firestore;
  memberDocId: string;
  suspend: boolean;
  /** Optional free text (NEW-7), only used when suspending. Stored on the member, NEVER copied to the audit log. */
  reason?: string | null;
  actor: Actor;
}

export type SuspendResult = { changed: boolean };

/**
 * TX-6: suspend or reactivate. Only the flag moves; the membership dates are untouched (Q3: no expiry extension). A
 * member without a membership cannot be suspended (so "Suspended" and "No membership" never overlap in the counts, FR-4).
 * Idempotent: suspending an already suspended member (e.g. two admins) reports `changed: false`.
 */
export async function setSuspendedTx(params: SuspendParams): Promise<SuspendResult> {
  const { db, memberDocId, suspend, actor } = params;
  if (actor.role !== 'ADMIN') {
    throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can suspend or reactivate a member.' });
  }
  const reason = suspend && params.reason?.trim() ? params.reason.replace(/\s+/g, ' ').trim() : null;
  if (reason !== null && reason.length > SUSPEND_REASON_MAX) {
    throw new AppError('INVALID_DATA', { userMessage: `The reason must be at most ${SUSPEND_REASON_MAX} characters.` });
  }
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    return await withContentionRetry(() =>
      runTransaction(
        db,
        async (tx): Promise<SuspendResult> => {
          const snap = await tx.get(memberRef);
          const data = snap.data();
          if (!snap.exists() || !data || data.deleted === true) throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
          const member = memberFromDoc(snap.id, data);
          if (suspend === member.suspended) return { changed: false };
          if (suspend && !member.hasMembership) {
            throw new AppError('INVALID_DATA', { userMessage: 'A member without a membership cannot be suspended.' });
          }

          tx.update(memberRef, {
            ...(suspend
              ? { suspended: true, suspendedAt: serverTimestamp(), suspendedReason: reason, suspendedBy: actor.uid }
              : { suspended: false, suspendedAt: null, suspendedReason: null, suspendedBy: null }),
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: auditRef.id,
          });
          tx.set(
            auditRef,
            auditDocData(actor, {
              action: suspend ? 'MEMBER_SUSPENDED' : 'MEMBER_REACTIVATED',
              entity: 'member',
              entityId: memberDocId,
              entityLabel: memberAuditLabel(member.memberId, member.displayName),
              // the reason is free text and could hold health details: only the fact that one was given is audited
              metadata: suspend ? { hasReason: reason !== null } : {},
            }),
          );
          return { changed: true };
        },
        { maxAttempts: MAX_ATTEMPTS },
      ),
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}
