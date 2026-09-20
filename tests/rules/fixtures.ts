import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { addAudit, currentYear, istMidnight, memberData, ROLE_OF } from './setup';

/**
 * Fixtures and commit builders for the plans / memberships / payments / attendance rules suites (US-8.2).
 *
 * The COMMIT builders write exactly the documents the app's transactions write (same field sets, same audit record, same
 * ids), with override knobs so a test can forge one detail at a time. Seeding uses `withSecurityRulesDisabled` (state that
 * already exists), never the rules under test.
 */

export const MEM = 'mem1';
export const MEMBER_ID_TEXT = `GYM-${currentYear()}-0001`;
export const PLAN = 'plan1';
export const MS = 'ms1';
export const PRICE = 150000; // Rs 1,500 in paise

/** A rule-valid membershipPlans body, seeded (rules disabled). */
export function planBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Monthly',
    nameLower: 'monthly',
    durationValue: 1,
    durationUnit: 'MONTHS',
    pricePaise: PRICE,
    description: null,
    active: true,
    createdAt: Timestamp.now(),
    createdBy: 'admin',
    updatedAt: Timestamp.now(),
    updatedBy: 'admin',
    ...over,
  };
}

/** 01/09/2026 .. 30/09/2026 (IST calendar days) unless overridden. */
export const START = istMidnight(2026, 9, 1);
export const END = istMidnight(2026, 9, 30);

export interface MembershipSeed {
  id?: string;
  memberDocId?: string;
  paidPaise?: number;
  amountPaise?: number;
  start?: Timestamp;
  end?: Timestamp;
}

/** Seed a membership document (rules disabled). Returns its id. */
export async function seedMembershipDoc(env: RulesTestEnvironment, o: MembershipSeed = {}): Promise<string> {
  const id = o.id ?? MS;
  const amount = o.amountPaise ?? PRICE;
  const paid = o.paidPaise ?? 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await writeBatch(db)
      .set(doc(db, 'memberships', id), {
        ...membershipBody('admin', {
          memberDocId: o.memberDocId ?? MEM,
          amountPaise: amount,
          paidPaise: paid,
          outstandingPaise: amount - paid,
          unpaid: amount - paid > 0,
          startDate: o.start ?? START,
          endDate: o.end ?? END,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          lastAuditId: `seed-${id}`,
        }),
      })
      .commit();
  });
  return id;
}

/** A rule-valid memberships/{id} body (as buildMembership writes it), timestamps are server times unless overridden. */
export function membershipBody(uid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const amount = typeof over.amountPaise === 'number' ? over.amountPaise : PRICE;
  const paid = typeof over.paidPaise === 'number' ? over.paidPaise : 0;
  return {
    memberDocId: MEM,
    memberId: MEMBER_ID_TEXT,
    memberDisplayName: 'Rahul Sharma',
    planId: PLAN,
    planName: 'Monthly',
    planDurationValue: 1,
    planDurationUnit: 'MONTHS',
    startDate: START,
    endDate: END,
    amountPaise: amount,
    paidPaise: paid,
    outstandingPaise: amount - paid,
    unpaid: amount - paid > 0,
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    lastAuditId: 'aud-ms',
    ...over,
  };
}

/**
 * Seed the state "member mem1 has membership ms1" (rules disabled): the plan, the membership and the member's summary +
 * pendingPaise, consistent with each other. `paidPaise` > 0 also seeds the payment `p-seed` for that amount.
 */
export async function seedMemberWithMembership(
  env: RulesTestEnvironment,
  o: { paidPaise?: number; memberOver?: Record<string, unknown>; amountPaise?: number } = {},
): Promise<void> {
  const amount = o.amountPaise ?? PRICE;
  const paid = o.paidPaise ?? 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const year = currentYear();
    const data = memberData({ uid: 'admin', seq: 1 });
    data.consent = { ...(data.consent as object), at: Timestamp.now() };
    data.createdAt = Timestamp.now();
    data.updatedAt = Timestamp.now();
    const batch = writeBatch(db);
    batch.set(doc(db, 'counters', `memberId-${year}`), { year, lastSeq: 1, lastMemberDocId: MEM, updatedAt: Timestamp.now(), updatedBy: 'admin' });
    batch.set(doc(db, 'members', MEM), {
      ...data,
      hasMembership: true,
      membership: { membershipId: MS, planId: PLAN, planName: 'Monthly', startDate: START, endDate: END, amountPaise: amount },
      pendingPaise: amount - paid,
      ...o.memberOver,
    });
    batch.set(doc(db, 'membershipPlans', PLAN), planBody({ pricePaise: amount }));
    await batch.commit();
  });
  await seedMembershipDoc(env, { amountPaise: amount, paidPaise: paid });
  if (paid > 0) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await writeBatch(db).set(doc(db, 'payments', 'p-seed'), paymentBody('admin', { amountPaise: paid, createdAt: Timestamp.now(), lastAuditId: 'seed-pay' })).commit();
    });
  }
}

/** A rule-valid payments/{id} body (as buildPaymentDoc writes it). */
export function paymentBody(uid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    memberDocId: MEM,
    memberId: MEMBER_ID_TEXT,
    memberDisplayName: 'Rahul Sharma',
    membershipId: MS,
    amountPaise: 50000,
    paymentDate: istMidnight(2026, 9, 2),
    method: 'UPI',
    transactionReference: 'UPI-1',
    notes: null,
    voided: false,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: serverTimestamp(),
    createdBy: uid,
    createdByName: 'Tester',
    lastAuditId: 'aud-pay',
    ...over,
  };
}

export interface PaymentCommitOptions {
  paymentId?: string;
  membershipId?: string;
  /** the payment amount */
  amount?: number;
  /** what the membership / member currently hold (must match the seeded state) */
  paidBefore?: number;
  pendingBefore?: number;
  /** what the commit writes (default: consistent with `amount`) */
  paidAfter?: number;
  outstandingAfter?: number;
  pendingAfter?: number;
  paymentOver?: Record<string, unknown>;
  membershipOver?: Record<string, unknown>;
  memberOver?: Record<string, unknown>;
  auditOver?: Record<string, unknown>;
  auditId?: string;
  auditEntityId?: string;
  auditAction?: string;
  omitPayment?: boolean;
  omitMembership?: boolean;
  omitMember?: boolean;
  omitAudit?: boolean;
}

/** TX-4 as a batch: payment + membership paid/outstanding/unpaid + member pendingPaise + audit, exactly as recordPaymentTx writes. */
export function paymentCommit(db: Firestore, uid: string, o: PaymentCommitOptions = {}) {
  const paymentId = o.paymentId ?? 'p1';
  const membershipId = o.membershipId ?? MS;
  const amount = o.amount ?? 50000;
  const paidBefore = o.paidBefore ?? 0;
  const pendingBefore = o.pendingBefore ?? PRICE - paidBefore;
  const paidAfter = o.paidAfter ?? paidBefore + amount;
  const outstandingAfter = o.outstandingAfter ?? PRICE - paidAfter;
  const pendingAfter = o.pendingAfter ?? pendingBefore - amount;
  const auditId = o.auditId ?? 'aud-pay';
  const batch = writeBatch(db);
  if (!o.omitPayment) {
    batch.set(doc(db, 'payments', paymentId), paymentBody(uid, { membershipId, amountPaise: amount, lastAuditId: auditId, ...o.paymentOver }));
  }
  if (!o.omitMembership) {
    batch.update(doc(db, 'memberships', membershipId), {
      paidPaise: paidAfter,
      outstandingPaise: outstandingAfter,
      unpaid: outstandingAfter > 0,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      lastAuditId: auditId,
      ...o.membershipOver,
    });
  }
  if (!o.omitMember) {
    batch.update(doc(db, 'members', MEM), { pendingPaise: pendingAfter, updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: auditId, ...o.memberOver });
  }
  if (!o.omitAudit) {
    addAudit(batch, db, uid, auditId, o.auditAction ?? 'PAYMENT_CREATED', 'payment', o.auditEntityId ?? paymentId, {
      metadata: { membershipId, amountPaise: amount, method: 'UPI' },
      ...o.auditOver,
    });
  }
  return batch.commit();
}

export interface VoidCommitOptions {
  paymentId?: string;
  reason?: string | null;
  amount?: number;
  paidBefore?: number;
  pendingBefore?: number;
  paidAfter?: number;
  pendingAfter?: number;
  paymentOver?: Record<string, unknown>;
  auditId?: string;
  auditAction?: string;
  omitMembership?: boolean;
  omitMember?: boolean;
  omitAudit?: boolean;
}

/** TX-5 as a batch: the one-way void of an existing payment, the membership and member restored, and the audit record. */
export function voidCommit(db: Firestore, uid: string, o: VoidCommitOptions = {}) {
  const paymentId = o.paymentId ?? 'p-seed';
  const amount = o.amount ?? 50000;
  const paidBefore = o.paidBefore ?? amount;
  const pendingBefore = o.pendingBefore ?? PRICE - paidBefore;
  const paidAfter = o.paidAfter ?? paidBefore - amount;
  const pendingAfter = o.pendingAfter ?? pendingBefore + amount;
  const auditId = o.auditId ?? 'aud-void';
  const batch = writeBatch(db);
  batch.update(doc(db, 'payments', paymentId), {
    voided: true,
    voidReason: o.reason === undefined ? 'entered against the wrong member' : o.reason,
    voidedAt: serverTimestamp(),
    voidedBy: uid,
    lastAuditId: auditId,
    ...o.paymentOver,
  });
  if (!o.omitMembership) {
    batch.update(doc(db, 'memberships', MS), {
      paidPaise: paidAfter,
      outstandingPaise: PRICE - paidAfter,
      unpaid: PRICE - paidAfter > 0,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      lastAuditId: auditId,
    });
  }
  if (!o.omitMember) {
    batch.update(doc(db, 'members', MEM), { pendingPaise: pendingAfter, updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: auditId });
  }
  if (!o.omitAudit) addAudit(batch, db, uid, auditId, o.auditAction ?? 'PAYMENT_VOIDED', 'payment', paymentId, { metadata: {} });
  return batch.commit();
}

export interface AssignCommitOptions {
  membershipId?: string;
  /** a first payment taken with the membership (paise), id `<membershipId>_first` */
  firstPaymentPaise?: number;
  /** the member's state before: hasMembership + summary end date + pending (default: no membership yet) */
  before?: { hasMembership: boolean; endDate: Timestamp | null; pendingPaise: number };
  start?: Timestamp;
  end?: Timestamp;
  membershipOver?: Record<string, unknown>;
  summaryOver?: Record<string, unknown>;
  memberOver?: Record<string, unknown>;
  auditId?: string;
  auditAction?: string;
  auditEntityId?: string;
  omitAudit?: boolean;
  omitMember?: boolean;
}

/** TX-2 / TX-3 as a batch: the NEW membership + the member summary update + the audit record (+ the optional first payment). */
export function assignCommit(db: Firestore, uid: string, o: AssignCommitOptions = {}) {
  const id = o.membershipId ?? 'ms2';
  const paid = o.firstPaymentPaise ?? 0;
  const before = o.before ?? { hasMembership: false, endDate: null, pendingPaise: 0 };
  const start = o.start ?? istMidnight(2026, 10, 1);
  const end = o.end ?? istMidnight(2026, 10, 31);
  const auditId = o.auditId ?? 'aud-assign';
  const outstanding = PRICE - paid;
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'memberships', id),
    membershipBody(uid, { startDate: start, endDate: end, paidPaise: paid, outstandingPaise: outstanding, unpaid: outstanding > 0, lastAuditId: auditId, ...o.membershipOver }),
  );
  if (!o.omitMember) {
    batch.update(doc(db, 'members', MEM), {
      hasMembership: true,
      membership: { membershipId: id, planId: PLAN, planName: 'Monthly', startDate: start, endDate: end, amountPaise: PRICE, ...o.summaryOver },
      pendingPaise: before.pendingPaise + outstanding,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      lastAuditId: auditId,
      ...o.memberOver,
    });
  }
  if (paid > 0) {
    const payAudit = `${auditId}-pay`;
    batch.set(doc(db, 'payments', `${id}_first`), paymentBody(uid, { membershipId: id, amountPaise: paid, lastAuditId: payAudit }));
    addAudit(batch, db, uid, payAudit, 'PAYMENT_CREATED', 'payment', `${id}_first`, { metadata: {} });
  }
  if (!o.omitAudit) addAudit(batch, db, uid, auditId, o.auditAction ?? 'MEMBERSHIP_CREATED', 'membership', o.auditEntityId ?? id, { metadata: {} });
  return batch.commit();
}

/** The role a fixture uid has (for readable test names). */
export const roleOf = (uid: string): string => ROLE_OF[uid] ?? uid;
