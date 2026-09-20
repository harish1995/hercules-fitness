import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MEM, paymentBody, paymentCommit, PRICE, seedMemberWithMembership, voidCommit } from './fixtures';
import { BROKEN_ROLE_UIDS, createTestEnv, dbFor, istMidnight, seedUsers } from './setup';

/**
 * Permission Matrix rows: "Record payment" (Admin only; Staff NO, resolved Q10), "View payment history / revenue" (Admin; Member
 * own only; Staff NO), "Void payment" (Admin only), plus AC-8 (overpayment) and AC-11 (a MEMBER cannot write payments).
 * A payment is immutable except a one-way void, and a balance can only change together with the payment that explains it.
 */
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
});

describe('payments: record (TX-4; matrix: Admin only, Staff denied)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env);
  });

  it('ADMIN can record a partial payment (payment + membership + member + audit in one commit)', async () => {
    await assertSucceeds(paymentCommit(dbFor(env, 'admin'), 'admin'));
  });

  it('ADMIN can pay the exact outstanding balance in full', async () => {
    await assertSucceeds(paymentCommit(dbFor(env, 'admin'), 'admin', { amount: PRICE }));
  });

  it('STAFF is denied (matrix: Staff cannot record payments), and so are MEMBER, anonymous and every broken-role user', async () => {
    for (const uid of ['staff', 'member1', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(paymentCommit(dbFor(env, uid), uid ?? 'x'));
    }
  });

  it('a payment for MORE than the outstanding balance is denied (overpayment, AC-8)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { amount: PRICE + 1 }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { amount: PRICE + 1, paidAfter: PRICE + 1, outstandingAfter: -1, pendingAfter: -1 }));
  });

  it.each([
    ['zero', 0],
    ['negative', -500],
    ['fractional paise', 100.5],
    ['a string', '500'],
  ])('a payment amount that is %s is denied', async (_label, amount) => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { amountPaise: amount } }));
  });

  it('the membership paid total must rise by EXACTLY the payment amount (no more, no less, no skipped update)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paidAfter: 60000, outstandingAfter: PRICE - 60000 }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paidAfter: 40000, outstandingAfter: PRICE - 40000 }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { omitMembership: true }));
  });

  it('the member pending total must fall by exactly the payment amount (drift is refused; so is skipping the member update)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { pendingAfter: PRICE })); // unchanged
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { pendingAfter: 0 })); // too much
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { omitMember: true }));
  });

  it('outstanding / unpaid must agree with the paid total on the membership', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { outstandingAfter: 1 }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { membershipOver: { unpaid: false } }));
  });

  it('the payment must be for a membership of THIS member (snapshot ids match)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { memberDocId: 'mem2' } }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { memberId: 'GYM-2026-0099' } }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { memberDisplayName: 'Someone Else' } }));
  });

  it('a payment dated in the future is denied; a past IST day is allowed; a non-midnight date is denied', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { paymentDate: istMidnight(2999, 1, 1) } }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { paymentDate: Timestamp.fromMillis(Date.UTC(2026, 8, 2, 12)) } }));
    await assertSucceeds(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { paymentDate: istMidnight(2020, 1, 1) } }));
  });

  it('only the five payment methods are accepted (no card data is ever stored)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { method: 'BITCOIN' } }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { cardNumber: '4111111111111111' } })); // unknown field
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { transactionReference: 'x'.repeat(101) } }));
  });

  it('createdBy is the caller and createdAt the server time (no forged authorship or clock)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { createdBy: 'staff' } }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { createdAt: Timestamp.fromDate(new Date('2020-01-01')) } }));
  });

  it('a payment cannot be created already voided', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paymentOver: { voided: true, voidReason: 'x', voidedAt: serverTimestamp(), voidedBy: 'admin' } }));
  });

  it('a payment WITHOUT the membership + member updates (a bare payment write) is denied', async () => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'payments', 'p9'), paymentBody('admin', { lastAuditId: 'nope' })));
  });

  it('a membership / member balance change WITHOUT a payment document is denied (dues cannot be edited on their own)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { omitPayment: true }));
  });
});

describe('payments: immutable, one-way void (TX-5; matrix: Admin only)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env, { paidPaise: 50000 });
  });

  it('ADMIN can void a payment once: the membership and member are restored exactly in the same commit', async () => {
    await assertSucceeds(voidCommit(dbFor(env, 'admin'), 'admin'));
  });

  it('STAFF, MEMBER, anonymous and every broken-role user cannot void', async () => {
    for (const uid of ['staff', 'member1', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(voidCommit(dbFor(env, uid), uid ?? 'x'));
    }
  });

  it('a void without a reason (or with a blank one), or that restores the wrong amount, is denied', async () => {
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { reason: null }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { reason: '   ' }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { reason: 'x'.repeat(201) }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { paidAfter: 10000 }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { pendingAfter: 1 }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { omitMembership: true }));
  });

  it('a void cannot be undone and cannot be repeated', async () => {
    await assertSucceeds(voidCommit(dbFor(env, 'admin'), 'admin'));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { auditId: 'aud-void2', paidBefore: 0, pendingBefore: PRICE }));
    await assertFails(
      updateDoc(doc(dbFor(env, 'admin'), 'payments', 'p-seed'), { voided: false, voidReason: null, voidedAt: null, voidedBy: null, lastAuditId: 'un' }),
    );
  });

  it('a void cannot smuggle a change of amount, date, method or membership', async () => {
    for (const over of [{ amountPaise: 1 }, { paymentDate: istMidnight(2020, 1, 1) }, { method: 'CASH' }, { membershipId: 'other' }, { memberDocId: 'mem2' }]) {
      await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { paymentOver: over }));
    }
  });

  it('a payment is never edited or deleted: not by Admin, Staff or Member (AC-11)', async () => {
    for (const uid of ['admin', 'staff', 'member1']) {
      const db = dbFor(env, uid);
      await assertFails(updateDoc(doc(db, 'payments', 'p-seed'), { amountPaise: 1 }));
      await assertFails(updateDoc(doc(db, 'payments', 'p-seed'), { notes: 'x' }));
      await assertFails(updateDoc(doc(db, 'payments', 'p-seed'), { paymentDate: istMidnight(2020, 1, 1) }));
      await assertFails(deleteDoc(doc(db, 'payments', 'p-seed')));
    }
  });
});

describe('payments: view (matrix: Admin yes, Staff NO, Member own only)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env, { paidPaise: 50000 });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as never, 'payments', 'p-other'), paymentBody('admin', { memberDocId: 'mem2', createdAt: Timestamp.now() }));
    });
  });

  it('ADMIN can get and list', async () => {
    await assertSucceeds(getDoc(doc(dbFor(env, 'admin'), 'payments', 'p-seed')));
    await assertSucceeds(getDocs(collection(dbFor(env, 'admin'), 'payments')));
  });

  it('STAFF can neither get nor list payments nor read revenue (matrix)', async () => {
    const staff = dbFor(env, 'staff');
    await assertFails(getDoc(doc(staff, 'payments', 'p-seed')));
    await assertFails(getDocs(collection(staff, 'payments')));
    await assertFails(getDocs(query(collection(staff, 'payments'), where('voided', '==', false))));
  });

  it('a MEMBER reads only their own payments, never another member\'s or the collection', async () => {
    const m = dbFor(env, 'member1');
    await assertSucceeds(getDoc(doc(m, 'payments', 'p-seed')));
    await assertSucceeds(getDocs(query(collection(m, 'payments'), where('memberDocId', '==', MEM))));
    await assertFails(getDoc(doc(m, 'payments', 'p-other')));
    await assertFails(getDocs(query(collection(m, 'payments'), where('memberDocId', '==', 'mem2'))));
    await assertFails(getDocs(collection(m, 'payments')));
  });

  it('anonymous and every broken-role user are denied', async () => {
    for (const uid of [null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(getDoc(doc(dbFor(env, uid), 'payments', 'p-seed')));
      await assertFails(getDocs(collection(dbFor(env, uid), 'payments')));
    }
  });
});

describe('payments: first payment taken with a NEW membership (registration / assign / renew)', () => {
  it('is covered by the memberships suite (paid + outstanding = price, id `<membershipId>_first`); a payment id that is not `_first` for a new membership is denied', async () => {
    await seedMemberWithMembership(env);
    const db = dbFor(env, 'admin');
    // a bare payment against a membership that does not exist yet is not a first payment (no `_first` id, no membership in the commit)
    await assertFails(setDoc(doc(db, 'payments', 'stray'), paymentBody('admin', { membershipId: 'ms-not-created' })));
  });
});
