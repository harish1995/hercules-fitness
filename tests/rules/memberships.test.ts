import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assignCommit, END, MEM, MS, paymentCommit, PLAN, planBody, PRICE, seedMembershipDoc, seedMemberWithMembership, START } from './fixtures';
import { addAudit, BROKEN_ROLE_UIDS, createTestEnv, dbFor, istMidnight, seedMember, seedUsers } from './setup';

/**
 * Permission Matrix rows: "Assign plan / renew" (Admin only), "View membership status & expiry" (Admin, Staff, Member own) and
 * AC-11 "a MEMBER cannot write payments or expiry dates". A membership is history: its period, plan and amount never change.
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

describe('memberships: assign / renew (matrix: Admin only)', () => {
  beforeEach(async () => {
    await seedMember(env, { docId: MEM });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await writeBatch(ctx.firestore() as never).set(doc(ctx.firestore() as never, 'membershipPlans', PLAN), planBody()).commit();
    });
  });

  it('ADMIN can assign a first membership (membership + member summary + audit in one commit)', async () => {
    await assertSucceeds(assignCommit(dbFor(env, 'admin'), 'admin'));
  });

  it('ADMIN can assign with a first payment taken in the same commit (paid + outstanding = price)', async () => {
    await assertSucceeds(assignCommit(dbFor(env, 'admin'), 'admin', { firstPaymentPaise: 50000 }));
  });

  it('STAFF, MEMBER, anonymous and every broken-role user cannot assign or renew', async () => {
    for (const uid of ['staff', 'member1', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(assignCommit(dbFor(env, uid), uid ?? 'x'));
    }
  });

  it.each([
    ['an end date before the start date', { endDate: istMidnight(2026, 9, 30), startDate: istMidnight(2026, 10, 1) }],
    ['a start date that is not IST midnight', { startDate: START.toMillis() + 1 }],
    ['an amount that differs from the active plan price', { amountPaise: 100, outstandingPaise: 100 }],
    ['a plan name that differs from the plan', { planName: 'Platinum' }],
    ['a duration that differs from the plan', { planDurationValue: 6 }],
    ['an inactive / unknown plan id', { planId: 'ghost' }],
    ['outstanding that is not amount - paid', { outstandingPaise: 1 }],
    ['unpaid that contradicts outstanding', { unpaid: false }],
    ['paid above the amount', { paidPaise: PRICE + 1, outstandingPaise: -1, unpaid: false }],
    ['a snapshot memberId that differs from the member', { memberId: 'GYM-2026-0099' }],
    ['a spoofed createdBy', { createdBy: 'staff' }],
    ['a client-clock createdAt', { createdAt: START }],
    ['an unknown extra field', { role: 'ADMIN' }],
  ])('create with %s is denied even for an Admin', async (_label, over) => {
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { membershipOver: over }));
  });

  it('a membership created WITHOUT the member summary update in the same commit is denied', async () => {
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { omitMember: true }));
  });

  it('the member summary must mirror the new membership (plan, period, amount) and pending must grow by exactly its outstanding', async () => {
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { summaryOver: { endDate: istMidnight(2030, 1, 1) } }));
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { summaryOver: { planName: 'Other' } }));
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { memberOver: { pendingPaise: 1 } }));
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { memberOver: { pendingPaise: 0 } })); // dues hidden
  });

  it('a first payment must accompany paidPaise > 0 (no phantom paid amount)', async () => {
    await assertFails(
      assignCommit(dbFor(env, 'admin'), 'admin', {
        membershipOver: { paidPaise: 50000, outstandingPaise: PRICE - 50000, unpaid: true },
        memberOver: { pendingPaise: PRICE - 50000 },
      }),
    );
  });

  it('a soft-deleted or suspended member cannot be renewed (NEW-7, D-8)', async () => {
    await env.clearFirestore();
    await seedUsers(env);
    await seedMemberWithMembership(env, { memberOver: { suspended: true } });
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { before: { hasMembership: true, endDate: END, pendingPaise: PRICE }, start: istMidnight(2026, 10, 1), end: istMidnight(2026, 10, 31) }));
    await env.clearFirestore();
    await seedUsers(env);
    await seedMemberWithMembership(env, { memberOver: { deleted: true } });
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { before: { hasMembership: true, endDate: END, pendingPaise: PRICE } }));
  });
});

describe('memberships: renew keeps history and only moves the latest end date forward (D-5)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env);
  });

  it('a renewal that starts after the latest end date is allowed', async () => {
    await assertSucceeds(assignCommit(dbFor(env, 'admin'), 'admin', { before: { hasMembership: true, endDate: END, pendingPaise: PRICE } }));
  });

  it('a back-dated membership (ending before the current latest end date) cannot pull the member summary backwards', async () => {
    await assertFails(
      assignCommit(dbFor(env, 'admin'), 'admin', {
        before: { hasMembership: true, endDate: END, pendingPaise: PRICE },
        start: istMidnight(2026, 5, 1),
        end: istMidnight(2026, 5, 31),
      }),
    );
  });

  it('the summary cannot be re-pointed at an OLD membership (it must name one created in this commit)', async () => {
    const admin = dbFor(env, 'admin');
    const batch = writeBatch(admin);
    batch.update(doc(admin, 'members', MEM), {
      membership: { membershipId: MS, planId: PLAN, planName: 'Monthly', startDate: START, endDate: istMidnight(2027, 1, 1), amountPaise: PRICE },
      updatedAt: serverTimestamp(), updatedBy: 'admin', lastAuditId: 'x1',
    });
    addAudit(batch, admin, 'admin', 'x1', 'MEMBERSHIP_RENEWED', 'membership', MS);
    await assertFails(batch.commit());
  });
});

describe('memberships: immutable history, never deleted (AC-11: no expiry edits)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env);
  });

  const editMembership = (uid: string, fields: Record<string, unknown>, withAudit = true) => {
    const db = dbFor(env, uid);
    const batch = writeBatch(db);
    batch.update(doc(db, 'memberships', MS), { updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: 'e1', ...fields });
    if (withAudit) addAudit(batch, db, uid, 'e1', 'MEMBERSHIP_RENEWED', 'membership', MS);
    return batch.commit();
  };

  it('nobody can change the period, plan or amount: not the member, not Staff, not even an Admin', async () => {
    for (const uid of ['member1', 'staff', 'admin']) {
      await assertFails(editMembership(uid, { endDate: istMidnight(2030, 1, 1) }));
      await assertFails(editMembership(uid, { startDate: istMidnight(2020, 1, 1) }));
      await assertFails(editMembership(uid, { amountPaise: 1, outstandingPaise: 1 }));
      await assertFails(editMembership(uid, { planId: 'other' }));
      await assertFails(editMembership(uid, { memberDocId: 'mem2' }));
    }
  });

  it('a balance change WITHOUT the payment that explains it is denied (paid cannot be edited on its own)', async () => {
    await assertFails(editMembership('admin', { paidPaise: PRICE, outstandingPaise: 0, unpaid: false }));
    await assertFails(editMembership('admin', { paidPaise: 0, outstandingPaise: PRICE, unpaid: true }));
  });

  it('memberships are never deleted, by anyone', async () => {
    for (const uid of ['admin', 'staff', 'member1', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(deleteDoc(doc(dbFor(env, uid), 'memberships', MS)));
    }
  });

  it('a MEMBER cannot write a payment (AC-11) or touch the membership through a payment commit', async () => {
    await assertFails(paymentCommit(dbFor(env, 'member1'), 'member1'));
  });
});

describe('memberships: view (matrix: Admin yes, Staff yes, Member own only)', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env);
    await seedMembershipDoc(env, { id: 'ms-other', memberDocId: 'mem2' });
  });

  it('ADMIN and STAFF can get and list', async () => {
    for (const uid of ['admin', 'staff']) {
      await assertSucceeds(getDoc(doc(dbFor(env, uid), 'memberships', MS)));
      await assertSucceeds(getDocs(query(collection(dbFor(env, uid), 'memberships'), where('memberDocId', '==', MEM))));
    }
  });

  it('a MEMBER reads only their own memberships (linked member id), never another member\'s', async () => {
    const m = dbFor(env, 'member1');
    await assertSucceeds(getDoc(doc(m, 'memberships', MS)));
    await assertSucceeds(getDocs(query(collection(m, 'memberships'), where('memberDocId', '==', MEM))));
    await assertFails(getDoc(doc(m, 'memberships', 'ms-other')));
    await assertFails(getDocs(query(collection(m, 'memberships'), where('memberDocId', '==', 'mem2'))));
    await assertFails(getDocs(collection(m, 'memberships')));
    await assertSucceeds(getDoc(doc(dbFor(env, 'member2'), 'memberships', 'ms-other')));
  });

  it('anonymous and every broken-role user are denied', async () => {
    for (const uid of [null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(getDoc(doc(dbFor(env, uid), 'memberships', MS)));
      await assertFails(getDocs(collection(dbFor(env, uid), 'memberships')));
    }
  });
});
