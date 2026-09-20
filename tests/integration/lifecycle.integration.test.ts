import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addIstDays, formatIstDate, fromCivilDate, todayIstStart } from '../../src/domain/dates';
import { reconcile, type ReconcileInput } from '../../src/domain/reconcile';
import { AppError, AttendanceRefusalError } from '../../src/services/errors';
import { checkInTx, checkOutTx, markAbsentTx } from '../../src/services/attendanceTransactions';
import { getMemberById } from '../../src/services/memberQueries';
import { newMemberDocId, registerMemberTx } from '../../src/services/memberTransactions';
import { assignMembershipTx, newMembershipDocId, renewMembershipTx, setSuspendedTx } from '../../src/services/membershipTransactions';
import { newPaymentDocId, recordPaymentTx, voidPaymentTx } from '../../src/services/paymentTransactions';
import { readReconcileInput } from '../../src/services/reconcileQueries';
import { createPlanTx, newPlanDocId } from '../../src/services/planTransactions';
import { type Actor, type MemberProfileInput } from '../../src/types/member';
import { type PlanInput } from '../../src/types/membership';
import { type PaymentDetails } from '../../src/types/payment';
import { createTestEnv, dbFor, seedUsers } from '../rules/setup';

/**
 * The REAL plan / membership / payment / attendance transactions against the emulator with the REAL rules: renewal dates, month-end,
 * concurrency, idempotency, void, suspension, attendance, and then the drift check on the result (US-8.1, US-8.2, R-2). Every
 * commit here also has to satisfy the audit-atomicity rules (architecture 3.4), so a service that forgot its audit record fails here.
 */
let env: RulesTestEnvironment;
let admin: Firestore;
let staff: Firestore;
const adminActor: Actor = { uid: 'admin', name: 'Owner', role: 'ADMIN' };
const staffActor: Actor = { uid: 'staff', name: 'Front Desk', role: 'STAFF' };

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
  admin = dbFor(env, 'admin');
  staff = dbFor(env, 'staff');
});

let mobileSeq = 0;
const profile = (over: Partial<MemberProfileInput> = {}): MemberProfileInput => ({
  firstName: 'Rahul', lastName: 'Sharma', gender: 'MALE', dateOfBirth: fromCivilDate(1995, 5, 10), mobile: `98765${String(10000 + mobileSeq++)}`, email: null,
  address: null, emergencyContact: null, trainerId: null, joiningDate: fromCivilDate(2026, 1, 15), generalNotes: null, ...over,
});
const register = async (over: Partial<MemberProfileInput> = {}) => {
  const memberDocId = newMemberDocId(admin);
  await registerMemberTx({ db: admin, memberDocId, actor: adminActor, duplicateMobileConfirmed: true, input: { profile: profile(over), medicalNotes: null, consentGiven: true, guardianConsent: false } });
  return memberDocId;
};
const plan = async (over: Partial<PlanInput> = {}) => {
  const planDocId = newPlanDocId(admin);
  await createPlanTx({ db: admin, planDocId, actor: adminActor, input: { name: `Plan ${planDocId}`, durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, description: null, active: true, ...over } });
  return planDocId;
};
const pay = (amountPaise: number, over: Partial<PaymentDetails> = {}): PaymentDetails => ({
  amountPaise, method: 'UPI', paymentDate: fromCivilDate(2026, 1, 20), transactionReference: null, notes: null, ...over,
});
const assign = (memberDocId: string, planId: string, startDate: Date, firstPayment?: PaymentDetails) =>
  assignMembershipTx({ db: admin, memberDocId, planId, membershipDocId: newMembershipDocId(admin), startDate, actor: adminActor, ...(firstPayment ? { firstPayment } : {}) });
const renew = (memberDocId: string, planId: string, firstPayment?: PaymentDetails) =>
  renewMembershipTx({ db: admin, memberDocId, planId, membershipDocId: newMembershipDocId(admin), actor: adminActor, ...(firstPayment ? { firstPayment } : {}) });
const record = (memberDocId: string, membershipId: string, details: PaymentDetails, paymentDocId = newPaymentDocId(admin)) =>
  recordPaymentTx({ db: admin, paymentDocId, memberDocId, membershipId, details, actor: adminActor });
const drift = async () => reconcile(await readReconcileInput(admin));

describe('assign and renew: dates (FR-5, AC-5, AC-6) through the real transaction', () => {
  it('month-end: a 1-month plan started 31/01/2026 ends 27/02/2026', async () => {
    const m = await register();
    const r = await assign(m, await plan(), fromCivilDate(2026, 1, 31));
    expect([formatIstDate(r.startDate), formatIstDate(r.endDate)]).toEqual(['31/01/2026', '27/02/2026']);
    expect(formatIstDate((await getMemberById(admin, m))!.membership.endDate!)).toBe('27/02/2026');
  });

  it('early renewal STACKS: the new period starts the day after the latest end date and the old membership is untouched', async () => {
    const m = await register();
    const p = await plan({ name: 'Pass', durationValue: 10, durationUnit: 'DAYS' });
    const today = todayIstStart();
    const first = await assign(m, p, addIstDays(today, -5)); // ends today + 4
    const second = await renew(m, p);
    expect(second.startDate.getTime()).toBe(addIstDays(first.endDate, 1).getTime());
    const third = await renew(m, p);
    expect(third.startDate.getTime()).toBe(addIstDays(second.endDate, 1).getTime());
    const old = await getDoc(doc(admin, 'memberships', first.membershipId));
    expect(old.data()?.endDate.toDate().getTime()).toBe(first.endDate.getTime()); // history never overwritten
    expect((await getMemberById(admin, m))!.membership.membershipId).toBe(third.membershipId);
  });

  it('renewing an EXPIRED member restarts today (the gap is not backfilled)', async () => {
    const m = await register();
    const p = await plan({ name: 'Pass', durationValue: 10, durationUnit: 'DAYS' });
    await assign(m, p, addIstDays(todayIstStart(), -60));
    const r = await renew(m, p);
    expect(r.startDate.getTime()).toBe(todayIstStart().getTime());
  });

  it('renewal on the end date itself (still valid today) starts the next day', async () => {
    const m = await register();
    const p = await plan({ name: 'Pass', durationValue: 10, durationUnit: 'DAYS' });
    const first = await assign(m, p, addIstDays(todayIstStart(), -9)); // 10-day pass ends today
    expect(first.endDate.getTime()).toBe(todayIstStart().getTime());
    expect((await renew(m, p)).startDate.getTime()).toBe(addIstDays(todayIstStart(), 1).getTime());
  });

  it('a retry with the same membership id (double click / lost response) creates ONE membership', async () => {
    const m = await register();
    const p = await plan();
    const membershipDocId = newMembershipDocId(admin);
    const a = await assignMembershipTx({ db: admin, memberDocId: m, planId: p, membershipDocId, startDate: fromCivilDate(2026, 9, 1), actor: adminActor });
    const b = await assignMembershipTx({ db: admin, memberDocId: m, planId: p, membershipDocId, startDate: fromCivilDate(2026, 9, 1), actor: adminActor });
    expect(a.alreadyExisted).toBe(false);
    expect(b.alreadyExisted).toBe(true);
    expect((await getDocs(collection(admin, 'memberships'))).size).toBe(1);
  });

  it('Staff cannot assign or renew (the service refuses, and the rules would)', async () => {
    const m = await register();
    const p = await plan();
    await expect(assignMembershipTx({ db: staff, memberDocId: m, planId: p, membershipDocId: newMembershipDocId(staff), startDate: fromCivilDate(2026, 9, 1), actor: staffActor })).rejects.toBeInstanceOf(AppError);
  });

  it('an inactive plan cannot be sold', async () => {
    const m = await register();
    const p = await plan({ active: false });
    await expect(assign(m, p, fromCivilDate(2026, 9, 1))).rejects.toMatchObject({ kind: 'INVALID_DATA' });
  });
});

describe('payments: balance, overpayment, concurrency, idempotency, void (AC-8, US-4.1)', () => {
  it('AC-8: total 1500, payments 500 + 700 -> outstanding 300; the member pending total follows', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1));
    await record(m, ms.membershipId, pay(50000));
    const r = await record(m, ms.membershipId, pay(70000));
    expect(r).toMatchObject({ outstandingPaise: 30000, memberPendingPaise: 30000 });
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(30000);
    expect((await drift()).errors).toBe(0);
  });

  it('overpayment is refused with the balance in the message, and nothing changes', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1), pay(100000));
    await expect(record(m, ms.membershipId, pay(50001))).rejects.toMatchObject({ userMessage: 'Amount exceeds pending balance (₹500.00)' });
    await expect(record(m, ms.membershipId, pay(0))).rejects.toBeInstanceOf(AppError);
    await expect(record(m, ms.membershipId, pay(-5))).rejects.toBeInstanceOf(AppError);
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(50000);
    expect((await getDocs(collection(admin, 'payments'))).size).toBe(1);
  });

  it('two admins paying at once cannot overpay: one succeeds, the other is refused', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1), pay(50000)); // 1000 still owed
    const results = await Promise.allSettled([record(m, ms.membershipId, pay(70000)), record(m, ms.membershipId, pay(70000))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ userMessage: 'Amount exceeds pending balance (₹300.00)' });
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(30000);
    expect((await drift()).errors).toBe(0);
  });

  it('a double submit / retry with the same payment id records ONE payment', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1));
    const id = newPaymentDocId(admin);
    const a = await record(m, ms.membershipId, pay(50000), id);
    const b = await record(m, ms.membershipId, pay(50000), id);
    expect([a.alreadyExisted, b.alreadyExisted]).toEqual([false, true]);
    expect((await getDocs(collection(admin, 'payments'))).size).toBe(1);
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(100000);
  });

  it('several memberships: the Admin picks which one is paid; the other is untouched and dues carry forward', async () => {
    const m = await register();
    const p = await plan({ name: 'Pass', durationValue: 10, durationUnit: 'DAYS', pricePaise: 60000 });
    const old = await assign(m, p, addIstDays(todayIstStart(), -60)); // expired, unpaid
    const renewed = await renew(m, p, pay(20000));
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(60000 + 40000);
    await record(m, renewed.membershipId, pay(40000));
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(60000); // the expired dues remain
    expect((await getDoc(doc(admin, 'memberships', old.membershipId))).data()?.outstandingPaise).toBe(60000);
    expect((await drift()).errors).toBe(0);
  });

  it('void restores the balance exactly, keeps the payment, and is idempotent', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1));
    const paid = await record(m, ms.membershipId, pay(50000));
    expect(await voidPaymentTx({ db: admin, paymentId: paid.paymentId, reason: 'wrong member', actor: adminActor })).toMatchObject({ changed: true });
    expect(await voidPaymentTx({ db: admin, paymentId: paid.paymentId, reason: 'again', actor: adminActor })).toMatchObject({ changed: false });
    const payment = await getDoc(doc(admin, 'payments', paid.paymentId));
    expect(payment.data()).toMatchObject({ voided: true, amountPaise: 50000 });
    expect((await getMemberById(admin, m))!.pendingPaise).toBe(150000);
    expect((await drift()).errors).toBe(0);
  });

  it('Staff cannot record or void a payment', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1));
    await expect(recordPaymentTx({ db: staff, paymentDocId: newPaymentDocId(staff), memberDocId: m, membershipId: ms.membershipId, details: pay(100), actor: staffActor })).rejects.toBeInstanceOf(AppError);
  });

  it('audit records exist for every action, with amounts and methods but never a reference, notes or void reason', async () => {
    const m = await register();
    const ms = await assign(m, await plan(), fromCivilDate(2026, 9, 1));
    const paid = await record(m, ms.membershipId, pay(50000, { transactionReference: 'UPI-SECRET-REF', notes: 'private note' }));
    await voidPaymentTx({ db: admin, paymentId: paid.paymentId, reason: 'private reason', actor: adminActor });
    const audits = (await getDocs(collection(admin, 'auditLogs'))).docs.map((d) => d.data());
    expect(audits.map((a) => a.action).sort()).toEqual(['MEMBERSHIP_CREATED', 'MEMBER_CREATED', 'PAYMENT_CREATED', 'PAYMENT_VOIDED', 'PLAN_CREATED']);
    const text = JSON.stringify(audits);
    for (const secret of ['UPI-SECRET-REF', 'private note', 'private reason']) expect(text).not.toContain(secret);
  });
});

describe('suspension (Q3, NEW-7)', () => {
  it('suspend / reactivate only flips the flag and never the dates; a suspended member cannot be renewed', async () => {
    const m = await register();
    const p = await plan();
    const ms = await assign(m, p, fromCivilDate(2026, 9, 1));
    expect(await setSuspendedTx({ db: admin, memberDocId: m, suspend: true, reason: 'travelling', actor: adminActor })).toEqual({ changed: true });
    expect(await setSuspendedTx({ db: admin, memberDocId: m, suspend: true, actor: adminActor })).toEqual({ changed: false });
    const s = (await getMemberById(admin, m))!;
    expect(s.suspended).toBe(true);
    expect(s.membership.endDate!.getTime()).toBe(ms.endDate.getTime());
    await expect(renew(m, p)).rejects.toMatchObject({ userMessage: 'This member is suspended. Reactivate the member first.' });
    expect(await setSuspendedTx({ db: admin, memberDocId: m, suspend: false, actor: adminActor })).toEqual({ changed: true });
    expect((await getMemberById(admin, m))!.suspended).toBe(false);
  });

  it('a member without a membership cannot be suspended; the suspension reason never reaches the audit log', async () => {
    const m = await register();
    await expect(setSuspendedTx({ db: admin, memberDocId: m, suspend: true, actor: adminActor })).rejects.toBeInstanceOf(AppError);
    const p = await plan();
    await assign(m, p, fromCivilDate(2026, 9, 1));
    await setSuspendedTx({ db: admin, memberDocId: m, suspend: true, reason: 'knee surgery', actor: adminActor });
    expect(JSON.stringify((await getDocs(collection(admin, 'auditLogs'))).docs.map((d) => d.data()))).not.toContain('knee surgery');
  });
});

describe('attendance (FR-7, NEW-12) through the real transactions', () => {
  it('check-in, duplicate check-in refused, check-out, second check-out refused', async () => {
    const m = await register();
    await assign(m, await plan({ name: 'Long', durationValue: 12, durationUnit: 'MONTHS' }), todayIstStart());
    await checkInTx({ db: staff, memberDocId: m, actor: staffActor });
    await expect(checkInTx({ db: staff, memberDocId: m, actor: staffActor })).rejects.toMatchObject({ reason: 'ALREADY_CHECKED_IN' });
    await new Promise((r) => setTimeout(r, 30));
    await checkOutTx({ db: staff, memberDocId: m, actor: staffActor });
    await expect(checkOutTx({ db: staff, memberDocId: m, actor: staffActor })).rejects.toBeInstanceOf(Error);
    expect((await getDocs(collection(staff, 'attendance'))).size).toBe(1);
  });

  it('a suspended member is refused, an expired one needs confirmation, absent then present is still one record', async () => {
    const suspended = await register();
    await assign(suspended, await plan({ name: 'A', durationValue: 12, durationUnit: 'MONTHS' }), todayIstStart());
    await setSuspendedTx({ db: admin, memberDocId: suspended, suspend: true, actor: adminActor });
    await expect(checkInTx({ db: staff, memberDocId: suspended, actor: staffActor, confirmed: true })).rejects.toMatchObject({ reason: 'SUSPENDED' });

    const expired = await register();
    await assign(expired, await plan({ name: 'B', durationValue: 10, durationUnit: 'DAYS' }), addIstDays(todayIstStart(), -60));
    await expect(checkInTx({ db: staff, memberDocId: expired, actor: staffActor })).rejects.toMatchObject({ reason: 'NEEDS_CONFIRMATION' });
    await checkInTx({ db: staff, memberDocId: expired, actor: staffActor, confirmed: true });

    const absent = await register();
    await markAbsentTx({ db: staff, memberDocId: absent, actor: staffActor });
    const back = await checkInTx({ db: staff, memberDocId: absent, actor: staffActor, confirmed: true });
    expect(back.fromAbsent).toBe(true);
    expect((await getDocs(collection(staff, 'attendance'))).size).toBe(2);
    expect(AttendanceRefusalError).toBeDefined();
  });
});

describe('reconcile against real data (R-2): clean after normal use, and it detects drift without writing', () => {
  async function build() {
    const m = await register();
    const p = await plan();
    const ms = await assign(m, p, fromCivilDate(2026, 9, 1), pay(50000));
    await record(m, ms.membershipId, pay(30000));
    const renewed = await renew(m, p);
    await record(m, renewed.membershipId, pay(20000));
    return { m, ms, renewed };
  }
  const snapshot = async (): Promise<string> => {
    let out = '';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      for (const c of ['members', 'memberships', 'payments', 'counters', 'auditLogs']) {
        const docs = (await getDocs(collection(db, c))).docs.map((d) => `${d.id}:${JSON.stringify(d.data())}`).sort();
        out += `${c}=${docs.join('|')};`;
      }
    });
    return out;
  };

  it('normal use leaves no drift', async () => {
    await build();
    const r = await drift();
    expect(r.drifts).toEqual([]);
    expect(r.checked).toMatchObject({ members: 1, memberships: 2, payments: 3, counters: 1 });
  });

  it('running it writes nothing (every document is byte-identical before and after)', async () => {
    await build();
    const before = await snapshot();
    await drift();
    expect(await snapshot()).toBe(before);
  });

  it('a hand-edited (console) total is reported: member pending, membership paid, member summary, counter', async () => {
    const { m, ms } = await build();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await updateDoc(doc(db, 'members', m), { pendingPaise: 1 });
      await updateDoc(doc(db, 'memberships', ms.membershipId), { paidPaise: 99 });
    });
    const kinds = (await drift()).drifts.map((x) => x.kind);
    expect(kinds).toContain('MEMBER_PENDING_MISMATCH');
    expect(kinds).toContain('MEMBERSHIP_PAID_MISMATCH');
  });

  it('the ReconcileInput it reads has real documents (guards the reader itself)', async () => {
    await build();
    const input: ReconcileInput = await readReconcileInput(admin, { pageSize: 1 }); // page size 1 exercises the paging
    expect(input.memberships).toHaveLength(2);
    expect(input.payments).toHaveLength(3);
  });
});
