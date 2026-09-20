import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { systemClock, todayIstStart, type Clock } from '../domain/dates';
import { addPaise, MoneyError, paise, subPaise } from '../domain/money';
import {
  applyPayment,
  applyVoid,
  paymentAmountError,
  paymentDetailsError,
  voidReasonError,
} from '../domain/payment';
import { type Actor } from '../types/member';
import { type PaymentDetails, type RecordedPayment, type VoidedPayment } from '../types/payment';
import { AppError } from './errors';
import { membershipFromDoc, memberFromDoc, paymentFromDoc } from './firestoreConverters';
import { buildPaymentDoc, paymentAuditData } from './paymentWrite';
import { MAX_ATTEMPTS, serializeTxError, withContentionRetry } from './txHelpers';

/**
 * Payment write transactions (architecture §2.7):
 *
 *   TX-4 recordPaymentTx  a payment against ONE membership, chosen explicitly by the Admin (NEW-10)
 *   TX-5 voidPaymentTx    the one-way void of a payment, with a required reason (NEW-9)
 *
 * Each is exactly ONE transaction: all reads first, then the payment, the membership's denormalized paid / outstanding /
 * unpaid, the member's `pendingPaise` and the audit record commit together or not at all (US-4.1f). The overpayment check
 * runs INSIDE the transaction against the freshly read balance, so two admins paying at once cannot overpay (US-4.1g): the
 * loser is refused by the rules (its snapshot is stale), `withContentionRetry` re-runs it, and it then fails with the
 * real, now-visible "exceeds pending balance" message. The payment id is pre-generated once per dialog, so a double click
 * or a retry after a commit that actually succeeded records only ONE payment (US-4.1h).
 *
 * Payments are NEVER edited or deleted (the rules refuse it): a mistake is corrected by a void. All arithmetic is integer
 * paise. Admin only (matrix: Staff cannot record or void payments). Nothing here logs; errors carry no payment data.
 */

/** Pre-generate the payment document id (create it ONCE per dialog so retries are idempotent). */
export function newPaymentDocId(db: Firestore): string {
  return doc(collection(db, COLLECTIONS.payments)).id;
}

const outOfSync = (cause: unknown) =>
  new AppError('INVALID_DATA', {
    cause,
    userMessage: 'The stored balance for this member does not add up, so nothing was changed. Please contact support.',
  });

export interface RecordPaymentParams {
  db: Firestore;
  /** From `newPaymentDocId`, created ONCE per dialog. */
  paymentDocId: string;
  memberDocId: string;
  /** The membership the money is for (explicit, never auto-allocated). */
  membershipId: string;
  details: PaymentDetails;
  actor: Actor;
  clock?: Clock;
}

/** TX-4. See the module comment. Throws AppError with a user-safe message on any refusal. */
export async function recordPaymentTx(params: RecordPaymentParams): Promise<RecordedPayment> {
  const { db, paymentDocId, memberDocId, membershipId, details, actor, clock = systemClock } = params;
  if (actor.role !== 'ADMIN') {
    throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can record a payment.' });
  }
  // Everything that does not depend on the stored balance is checked before any read (amount > 0, date, method, texts).
  const early = paymentDetailsError(details, Number.MAX_SAFE_INTEGER, todayIstStart(clock));
  if (early) throw new AppError('INVALID_DATA', { userMessage: early });

  const paymentRef = doc(db, COLLECTIONS.payments, paymentDocId);
  const membershipRef = doc(db, COLLECTIONS.memberships, membershipId);
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    return await withContentionRetry(() =>
      runTransaction(
        db,
        async (tx): Promise<RecordedPayment> => {
          // ---- READS (all before any write) ----
          const paymentSnap = await tx.get(paymentRef);
          const membershipSnap = await tx.get(membershipRef);
          const memberSnap = await tx.get(memberRef);
          const membershipData = membershipSnap.data();
          if (!membershipSnap.exists() || !membershipData) {
            throw new AppError('NOT_FOUND', { userMessage: 'This membership no longer exists.' });
          }
          const membership = membershipFromDoc(membershipSnap.id, membershipData);
          const memberData = memberSnap.data();
          if (membership.memberDocId !== memberDocId || !memberSnap.exists() || !memberData || memberData.deleted === true) {
            throw new AppError('NOT_FOUND', { userMessage: 'Member not found.' });
          }
          const member = memberFromDoc(memberSnap.id, memberData);

          if (paymentSnap.exists()) {
            // a retry / double submit of a commit that already succeeded: report it, write nothing
            const existing = paymentFromDoc(paymentSnap.id, paymentSnap.data() ?? {});
            return {
              paymentId: existing.id, membershipId: existing.membershipId, amountPaise: existing.amountPaise,
              outstandingPaise: membership.outstandingPaise, memberPendingPaise: member.pendingPaise, alreadyExisted: true,
            };
          }

          // ---- COMPUTE (from the FRESHLY read balances) ----
          const tooMuch = paymentAmountError(details.amountPaise, membership.outstandingPaise);
          if (tooMuch) throw new AppError('INVALID_DATA', { userMessage: tooMuch });
          let balance;
          let pending;
          try {
            balance = applyPayment(membership, details.amountPaise);
            pending = subPaise(paise(member.pendingPaise), paise(details.amountPaise));
          } catch (e) {
            throw e instanceof MoneyError ? outOfSync(e) : e;
          }

          // ---- WRITES ----
          tx.set(paymentRef, buildPaymentDoc({
            memberDocId, memberId: membership.memberId, memberDisplayName: membership.memberDisplayName, membershipId,
            details, actor, auditId: auditRef.id,
          }));
          tx.update(membershipRef, {
            paidPaise: balance.paidPaise,
            outstandingPaise: balance.outstandingPaise,
            unpaid: balance.unpaid,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: auditRef.id,
          });
          tx.update(memberRef, { pendingPaise: pending, updatedAt: serverTimestamp(), updatedBy: actor.uid, lastAuditId: auditRef.id });
          tx.set(auditRef, paymentAuditData(actor, 'PAYMENT_CREATED', paymentRef.id, {
            memberId: membership.memberId, memberDisplayName: membership.memberDisplayName, membershipId,
            amountPaise: details.amountPaise, method: details.method,
          }));
          return {
            paymentId: paymentRef.id, membershipId, amountPaise: details.amountPaise,
            outstandingPaise: balance.outstandingPaise, memberPendingPaise: pending, alreadyExisted: false,
          };
        },
        { maxAttempts: MAX_ATTEMPTS },
      ),
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface VoidPaymentParams {
  db: Firestore;
  paymentId: string;
  /** Required (NEW-9). Stored on the payment, NEVER copied to the audit record. */
  reason: string;
  actor: Actor;
}

/**
 * TX-5. Flags the payment void (one-way), takes its amount back out of the membership's paid total (outstanding is restored
 * exactly) and back into the member's `pendingPaise`, all in one commit with the audit record. The payment document is kept (history is never deleted) and is excluded from revenue by `voided == false`.
 * Idempotent: voiding an already voided payment reports `changed: false` and writes nothing. A soft-deleted member's payment
 * can still be voided: the member document (which nothing may write once deleted) is then left alone, and its dues are
 * already excluded from every list and total.
 */
export async function voidPaymentTx(params: VoidPaymentParams): Promise<VoidedPayment> {
  const { db, paymentId, actor } = params;
  if (actor.role !== 'ADMIN') {
    throw new AppError('PERMISSION_DENIED', { userMessage: 'Only an Admin can void a payment.' });
  }
  const problem = voidReasonError(params.reason);
  if (problem) throw new AppError('INVALID_DATA', { userMessage: problem });
  const reason = params.reason.replace(/\s+/g, ' ').trim();

  const paymentRef = doc(db, COLLECTIONS.payments, paymentId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));

  try {
    return await withContentionRetry(() =>
      runTransaction(
        db,
        async (tx): Promise<VoidedPayment> => {
          // ---- READS ----
          const paymentSnap = await tx.get(paymentRef);
          const paymentData = paymentSnap.data();
          if (!paymentSnap.exists() || !paymentData) throw new AppError('NOT_FOUND', { userMessage: 'Payment not found.' });
          const payment = paymentFromDoc(paymentSnap.id, paymentData);
          if (payment.voided) return { paymentId, amountPaise: payment.amountPaise, changed: false };

          const membershipRef = doc(db, COLLECTIONS.memberships, payment.membershipId);
          const memberRef = doc(db, COLLECTIONS.members, payment.memberDocId);
          const membershipSnap = await tx.get(membershipRef);
          const membershipData = membershipSnap.data();
          if (!membershipSnap.exists() || !membershipData) throw new AppError('NOT_FOUND', { userMessage: 'The membership of this payment no longer exists.' });
          const membership = membershipFromDoc(membershipSnap.id, membershipData);
          const memberSnap = await tx.get(memberRef);
          const memberData = memberSnap.data();
          const member = memberSnap.exists() && memberData ? memberFromDoc(memberSnap.id, memberData) : null;

          // ---- COMPUTE ----
          let balance;
          let pending: number | null = null;
          try {
            balance = applyVoid(membership, payment.amountPaise);
            if (member && !member.deleted) pending = addPaise(paise(member.pendingPaise), paise(payment.amountPaise));
          } catch (e) {
            throw e instanceof MoneyError ? outOfSync(e) : e;
          }

          // ---- WRITES ----
          tx.update(paymentRef, {
            voided: true,
            voidReason: reason,
            voidedAt: serverTimestamp(),
            voidedBy: actor.uid,
            lastAuditId: auditRef.id,
          });
          tx.update(membershipRef, {
            paidPaise: balance.paidPaise,
            outstandingPaise: balance.outstandingPaise,
            unpaid: balance.unpaid,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: auditRef.id,
          });
          if (pending !== null) {
            tx.update(memberRef, { pendingPaise: pending, updatedAt: serverTimestamp(), updatedBy: actor.uid, lastAuditId: auditRef.id });
          }
          tx.set(auditRef, paymentAuditData(actor, 'PAYMENT_VOIDED', paymentRef.id, {
            memberId: payment.memberId, memberDisplayName: payment.memberDisplayName, membershipId: payment.membershipId,
            amountPaise: payment.amountPaise, method: payment.method,
          }));
          return { paymentId, amountPaise: payment.amountPaise, changed: true };
        },
        { maxAttempts: MAX_ATTEMPTS },
      ),
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}
