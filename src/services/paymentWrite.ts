import { collection, doc, serverTimestamp, type DocumentReference, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { memberAuditLabel } from '../domain/memberDiff';
import { type PaymentMethod } from '../constants/enums';
import { type Actor } from '../types/member';
import { type PaymentDetails } from '../types/payment';
import { auditDocData } from './auditService';
import { toTimestamp } from './firestoreConverters';

/**
 * Building blocks shared by every transaction that writes a payment (TX-4 record, and the FIRST payment that TX-1 / TX-2 /
 * TX-3 write together with a new membership), so the payment document and its audit record look identical wherever they
 * come from. Nothing here talks to Firestore.
 */

/**
 * The id of the first payment taken together with a NEW membership. It is derived from the (pre-generated) membership id, so
 * a retried submit targets the same payment (idempotent), and the security rules can tie a membership created with
 * `paidPaise > 0` to exactly this payment in the same commit (auto ids never contain an underscore).
 */
export const firstPaymentDocId = (membershipDocId: string): string => `${membershipDocId}_first`;

export interface PaymentBuildInput {
  memberDocId: string;
  /** readable `GYM-2026-0001` (snapshot) */
  memberId: string;
  memberDisplayName: string;
  membershipId: string;
  details: PaymentDetails;
  actor: Actor;
  /** the audit record written for this payment (its `lastAuditId`) */
  auditId: string;
}

/** payments/{id} body: immutable from now on except the one-way void (NEW-9). `createdBy` is the signed-in user, never form input. */
export function buildPaymentDoc(input: PaymentBuildInput): Record<string, unknown> {
  const { details, actor } = input;
  return {
    memberDocId: input.memberDocId,
    memberId: input.memberId,
    memberDisplayName: input.memberDisplayName,
    membershipId: input.membershipId,
    amountPaise: details.amountPaise,
    paymentDate: toTimestamp(details.paymentDate),
    method: details.method,
    transactionReference: details.transactionReference,
    notes: details.notes,
    voided: false,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name.slice(0, 100), // the rules cap it at 100
    lastAuditId: input.auditId,
  };
}

/**
 * PAYMENT_CREATED / PAYMENT_VOIDED audit body: membership id, amount and method only (US-4.8a). Never the transaction
 * reference, the notes or the void reason (free text): they could carry sensitive values, and card data must never appear.
 */
export function paymentAuditData(
  actor: Actor,
  action: 'PAYMENT_CREATED' | 'PAYMENT_VOIDED',
  paymentId: string,
  input: { memberId: string; memberDisplayName: string; membershipId: string; amountPaise: number; method: PaymentMethod },
) {
  return auditDocData(actor, {
    action,
    entity: 'payment',
    entityId: paymentId,
    entityLabel: memberAuditLabel(input.memberId, input.memberDisplayName),
    metadata: { membershipId: input.membershipId, amountPaise: input.amountPaise, method: input.method },
  });
}

export interface FirstPaymentWrites {
  paymentRef: DocumentReference;
  paymentData: Record<string, unknown>;
  auditRef: DocumentReference;
  auditData: Record<string, unknown>;
}

/**
 * The payment (and its own PAYMENT_CREATED audit record) taken together with a NEW membership (registration, assign, renew;
 * US-4.2c). The caller writes both documents in the same transaction as the membership, whose `paidPaise` equals this amount.
 */
export function buildFirstPayment(
  db: Firestore,
  input: Omit<PaymentBuildInput, 'auditId'> & { membershipDocId: string },
): FirstPaymentWrites {
  const paymentRef = doc(db, COLLECTIONS.payments, firstPaymentDocId(input.membershipDocId));
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  return {
    paymentRef,
    paymentData: buildPaymentDoc({ ...input, auditId: auditRef.id }),
    auditRef,
    auditData: paymentAuditData(input.actor, 'PAYMENT_CREATED', paymentRef.id, {
      memberId: input.memberId,
      memberDisplayName: input.memberDisplayName,
      membershipId: input.membershipId,
      amountPaise: input.details.amountPaise,
      method: input.details.method,
    }),
  };
}
