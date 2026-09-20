import { doc, serverTimestamp, type Firestore, type Transaction } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { istDayStart, toDayInputValue } from '../domain/dates';
import { memberAuditLabel } from '../domain/memberDiff';
import { balanceOf } from '../domain/payment';
import { computeEndDate } from '../domain/renewal';
import { type Actor } from '../types/member';
import { type Plan } from '../types/membership';
import { auditDocData } from './auditService';
import { AppError } from './errors';
import { planFromDoc, toTimestamp } from './firestoreConverters';

/**
 * Building blocks shared by every transaction that creates a membership (TX-1 with a plan, TX-2 assign, TX-3 renew), so
 * the membership document, its member-summary and its audit record are written identically wherever they come from.
 * Nothing here talks to Firestore except `readActivePlan` (which runs inside the caller's transaction).
 */

/** Read the plan INSIDE the transaction and refuse an unknown or inactive one (US-3.5d, US-3.2). */
export async function readActivePlan(tx: Transaction, db: Firestore, planId: string): Promise<Plan> {
  const snap = await tx.get(doc(db, COLLECTIONS.membershipPlans, planId));
  const data = snap.data();
  if (!snap.exists() || !data) throw new AppError('NOT_FOUND', { userMessage: 'The selected plan no longer exists. Choose another plan.' });
  const plan = planFromDoc(snap.id, data);
  if (!plan.active) {
    throw new AppError('INVALID_DATA', { userMessage: 'The selected plan is inactive. Choose an active plan.' });
  }
  return plan;
}

/** A start date must be a whole IST day (a browser-local Date must have gone through the IST helpers first). */
export function assertIstDay(date: Date): void {
  if (Number.isNaN(date.getTime()) || istDayStart(date).getTime() !== date.getTime()) {
    throw new AppError('INVALID_DATA', { userMessage: 'The membership start date is not a valid calendar day.' });
  }
}

export interface MembershipBuildInput {
  plan: Plan;
  start: Date;
  memberDocId: string;
  /** readable `GYM-2026-0001` (snapshot) */
  memberId: string;
  memberDisplayName: string;
  actor: Actor;
  /** the audit record written for this membership (its `lastAuditId`) */
  auditId: string;
  /** Integer paise taken together with the membership (the first payment, 0 = none). Never more than the plan price. */
  paidPaise?: number;
}

export interface BuiltMembership {
  end: Date;
  /** memberships/{id} body: a NEW membership, unpaid or with its first payment (paid + outstanding = the plan price). */
  data: Record<string, unknown>;
  /** the member's `membership` summary for this membership */
  summary: Record<string, unknown>;
  /** what this membership owes at creation: the amount added to the member's `pendingPaise` */
  outstandingPaise: number;
}

export function buildMembership(input: MembershipBuildInput, membershipId: string): BuiltMembership {
  const { plan, start, actor } = input;
  const end = computeEndDate(start, plan.durationValue, plan.durationUnit);
  const balance = balanceOf(plan.pricePaise, input.paidPaise ?? 0);
  const data = {
    memberDocId: input.memberDocId,
    memberId: input.memberId,
    memberDisplayName: input.memberDisplayName,
    planId: plan.id,
    planName: plan.name,
    planDurationValue: plan.durationValue,
    planDurationUnit: plan.durationUnit,
    startDate: toTimestamp(start),
    endDate: toTimestamp(end),
    amountPaise: plan.pricePaise,
    paidPaise: balance.paidPaise,
    outstandingPaise: balance.outstandingPaise,
    unpaid: balance.unpaid,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
    lastAuditId: input.auditId,
  };
  const summary = {
    membershipId,
    planId: plan.id,
    planName: plan.name,
    startDate: toTimestamp(start),
    endDate: toTimestamp(end),
    amountPaise: plan.pricePaise,
  };
  return { end, data, summary, outstandingPaise: balance.outstandingPaise };
}

/** MEMBERSHIP_CREATED / MEMBERSHIP_RENEWED audit body: plan, period and amount only (US-3.14a). */
export function membershipAuditData(
  actor: Actor,
  action: 'MEMBERSHIP_CREATED' | 'MEMBERSHIP_RENEWED',
  membershipId: string,
  input: { memberId: string; memberDisplayName: string; plan: Plan; start: Date; end: Date },
) {
  return auditDocData(actor, {
    action,
    entity: 'membership',
    entityId: membershipId,
    entityLabel: memberAuditLabel(input.memberId, input.memberDisplayName),
    metadata: {
      planName: input.plan.name,
      startDate: toDayInputValue(input.start),
      endDate: toDayInputValue(input.end),
      amountPaise: input.plan.pricePaise,
    },
  });
}
