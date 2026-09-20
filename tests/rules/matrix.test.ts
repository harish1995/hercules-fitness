import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  sum,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { istDayKey, todayIstStart } from '../../src/domain/dates';
import { assignCommit, END, MEM, MEMBER_ID_TEXT, paymentCommit, planBody, PRICE, seedMemberWithMembership, voidCommit } from './fixtures';
import { auditBody, createTestEnv, currentYear, dbFor, memberUpdate, registerBatch, seedUsers } from './setup';

/**
 * ONE traceable place for US-8.2a: a passing rules test for EACH row of the Permission Matrix (requirements, "Permission Matrix"),
 * each with its allowed AND denied cases. The rows are numbered 1..26 in the order of the matrix table. Deeper edge cases live in
 * the per-collection suites (members, memberMedical, photos, plans, memberships, payments, attendance, trainers, counters, audit,
 * auditAtomicity, roles, users, baseline); this file is the row-by-row proof, so a row cannot silently lose its test.
 *
 * Fixtures: admin (ADMIN), staff (STAFF), member1 (MEMBER linked to mem1), member2 (MEMBER linked to mem2), noRole, anon.
 */
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const A = () => dbFor(env, 'admin');
const S = () => dbFor(env, 'staff');
const M = () => dbFor(env, 'member1');
const M2 = () => dbFor(env, 'member2');
const ANON = () => dbFor(env, null);
const YEAR = currentYear();

beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
  // mem1 (live, with membership ms1, Rs 500 of Rs 1,500 paid), mem2 (a second member, for "own only" checks)
  await seedMemberWithMembership(env, { paidPaise: 50000 });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as never;
    const stamp = { updatedAt: Timestamp.now(), updatedBy: 'admin' };
    await setDoc(doc(db, 'members', 'mem2'), { ...(await ctx.firestore().doc('members/mem1').get()).data(), memberId: `GYM-${YEAR}-0002`, displayName: 'Other Person', searchMobile: '9123456780', mobile: '9123456780' });
    await setDoc(doc(db, 'memberMedical', MEM), { notes: 'asthma', ...stamp });
    await setDoc(doc(db, 'memberPhotos', MEM), { dataUrl: 'data:image/webp;base64,AAAA', contentType: 'image/webp', bytes: 10, width: 8, height: 8, ...stamp });
    await setDoc(doc(db, 'trainers', 't1'), { name: 'Amit', mobile: null, active: true, createdAt: Timestamp.now(), createdBy: 'admin', ...stamp });
    await setDoc(doc(db, 'auditLogs', 'a1'), { ...auditBody('admin', 'MEMBER_CREATED', 'member', MEM), at: Timestamp.now() });
    await setDoc(doc(db, 'attendance', `${MEM}_${istDayKey(new Date())}`), attendanceBody('staff', { checkInAt: Timestamp.fromMillis(Date.now() - 60_000), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    await setDoc(doc(db, 'attendance', `mem2_${istDayKey(new Date())}`), attendanceBody('staff', { memberDocId: 'mem2', checkInAt: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
  });
});

const attendanceBody = (uid: string, over: Record<string, unknown> = {}) => ({
  memberDocId: MEM, memberId: MEMBER_ID_TEXT, memberName: 'Rahul Sharma', date: Timestamp.fromDate(todayIstStart()), dateKey: istDayKey(new Date()),
  status: 'PRESENT', checkInAt: serverTimestamp(), checkOutAt: null, checkedOut: false,
  createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid, ...over,
});
const liveMembers = (db: ReturnType<typeof dbFor>) => query(collection(db, 'members'), where('deleted', '==', false));
const checkOut = (uid: string) => updateDoc(doc(dbFor(env, uid), 'attendance', `${MEM}_${istDayKey(new Date())}`), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: uid });

describe('Permission Matrix', () => {
  it('row 1: Login / own users doc read. Admin, Staff and Member read ONLY their own; anonymous and other users\' docs are denied', async () => {
    await assertSucceeds(getDoc(doc(A(), 'users', 'admin')));
    await assertSucceeds(getDoc(doc(S(), 'users', 'staff')));
    await assertSucceeds(getDoc(doc(M(), 'users', 'member1')));
    await assertFails(getDoc(doc(S(), 'users', 'admin')));
    await assertFails(getDoc(doc(M(), 'users', 'staff')));
    await assertFails(getDoc(doc(A(), 'users', 'staff')));
    await assertFails(getDoc(doc(ANON(), 'users', 'admin')));
    await assertFails(getDocs(collection(A(), 'users')));
  });

  it('row 2: Write any users doc / change a role. Denied for EVERYONE (console only), including a forged role on the own doc', async () => {
    for (const [db, uid] of [[A(), 'admin'], [S(), 'staff'], [M(), 'member1'], [dbFor(env, 'noRole'), 'noRole']] as const) {
      await assertFails(updateDoc(doc(db, 'users', uid), { role: 'ADMIN' }));
      await assertFails(setDoc(doc(db, 'users', uid), { email: 'x@example.com', displayName: 'X', role: 'ADMIN', active: true }));
      await assertFails(setDoc(doc(db, 'users', 'brandNew'), { role: 'ADMIN', active: true }));
      await assertFails(deleteDoc(doc(db, 'users', uid)));
    }
    await assertFails(setDoc(doc(ANON(), 'users', 'anon'), { role: 'ADMIN', active: true }));
  });

  it('row 3: View members list / profile (non-medical). Admin yes, Staff yes (live members only), Member own only', async () => {
    await assertSucceeds(getDoc(doc(A(), 'members', MEM)));
    await assertSucceeds(getDocs(liveMembers(A())));
    await assertSucceeds(getDoc(doc(S(), 'members', MEM)));
    await assertSucceeds(getDocs(liveMembers(S())));
    await assertSucceeds(getDoc(doc(M(), 'members', MEM)));
    await assertFails(getDoc(doc(M(), 'members', 'mem2')));
    await assertFails(getDocs(liveMembers(M())));
    await assertFails(getDoc(doc(ANON(), 'members', MEM)));
  });

  it('row 4: Register member. Admin yes; Staff yes but WITHOUT medical notes and WITHOUT a plan; Member no', async () => {
    await assertSucceeds(registerBatch(A(), { uid: 'admin', docId: 'new1', seq: 2, mobile: '9000000001' }).commit());
    await assertSucceeds(registerBatch(S(), { uid: 'staff', docId: 'new2', seq: 3, mobile: '9000000002' }).commit());
    await assertFails(setDoc(doc(S(), 'memberMedical', 'new2'), { notes: 'x', updatedAt: serverTimestamp(), updatedBy: 'staff' }));
    await assertFails(registerBatch(M(), { uid: 'member1', docId: 'new3', seq: 4, mobile: '9000000003' }).commit());
  });

  it('row 4b: Staff registering WITH a plan / payment section is denied (only Admin assigns a plan)', async () => {
    await env.clearFirestore();
    await seedUsers(env);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as never, 'membershipPlans', 'plan1'), planBody());
    });
    const staff = S();
    const batch = registerBatch(staff, { uid: 'staff', docId: 'new1', seq: 1, mobile: '9000000001', overrides: { hasMembership: true, pendingPaise: PRICE } });
    await assertFails(batch.commit());
  });

  it('row 5: Edit member profile. Admin yes; Staff no; Member no', async () => {
    await assertSucceeds(memberUpdate(A(), 'admin', MEM, { address: '12 MG Road' }));
    await assertFails(memberUpdate(S(), 'staff', MEM, { address: 'x', lastAuditId: 'b2' }));
    await assertFails(memberUpdate(M(), 'member1', MEM, { address: 'x', lastAuditId: 'b3' }));
  });

  it('row 6: Medical notes read/write. Admin yes; Staff NO (confirmed); Member no', async () => {
    await assertSucceeds(getDoc(doc(A(), 'memberMedical', MEM)));
    await assertSucceeds(setDoc(doc(A(), 'memberMedical', MEM), { notes: 'knee', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    for (const [db, uid] of [[S(), 'staff'], [M(), 'member1']] as const) {
      await assertFails(getDoc(doc(db, 'memberMedical', MEM)));
      await assertFails(getDocs(collection(db, 'memberMedical')));
      await assertFails(setDoc(doc(db, 'memberMedical', MEM), { notes: 'x', updatedAt: serverTimestamp(), updatedBy: uid }));
      await assertFails(deleteDoc(doc(db, 'memberMedical', MEM)));
    }
  });

  it('row 7: General notes. Admin read/write; Staff read only; Member cannot WRITE (see the README security notes for the read gap)', async () => {
    await assertSucceeds(memberUpdate(A(), 'admin', MEM, { generalNotes: 'prefers mornings' }));
    const snap = await getDoc(doc(S(), 'members', MEM)); // Staff reads the member doc, general notes included
    if (!snap.exists()) throw new Error('staff could not read the member');
    await assertFails(memberUpdate(S(), 'staff', MEM, { generalNotes: 'x', lastAuditId: 'b2' }));
    await assertFails(memberUpdate(M(), 'member1', MEM, { generalNotes: 'x', lastAuditId: 'b3' }));
  });

  it('row 8: Profile photo view / upload. Admin view + upload + replace; Staff view + upload only at registration (no replace); Member own view', async () => {
    const photo = (uid: string) => ({ dataUrl: 'data:image/webp;base64,AAAA', contentType: 'image/webp', bytes: 10, width: 8, height: 8, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(getDoc(doc(A(), 'memberPhotos', MEM)));
    await assertSucceeds(getDoc(doc(S(), 'memberPhotos', MEM)));
    await assertSucceeds(getDoc(doc(M(), 'memberPhotos', MEM)));
    await assertFails(getDoc(doc(M2(), 'memberPhotos', MEM)));
    await assertSucceeds(setDoc(doc(A(), 'memberPhotos', MEM), photo('admin'))); // replace
    await assertFails(setDoc(doc(S(), 'memberPhotos', MEM), photo('staff'))); // Staff cannot replace
    await assertFails(setDoc(doc(M(), 'memberPhotos', MEM), photo('member1')));
    await assertFails(deleteDoc(doc(S(), 'memberPhotos', MEM)));
    await assertSucceeds(deleteDoc(doc(A(), 'memberPhotos', MEM)));
    await assertSucceeds(setDoc(doc(S(), 'memberPhotos', MEM), photo('staff'))); // add after removal (create) is allowed for Staff
  });

  it('row 9: Suspend / reactivate / soft-delete member. Admin yes; Staff no; Member no', async () => {
    const suspend = (uid: string, db: ReturnType<typeof dbFor>, id: string) =>
      memberUpdate(db, uid, MEM, { suspended: true, suspendedAt: serverTimestamp(), suspendedReason: null, suspendedBy: uid, lastAuditId: id }, { action: 'MEMBER_SUSPENDED' });
    const del = (uid: string, db: ReturnType<typeof dbFor>, id: string) =>
      memberUpdate(db, uid, MEM, { deleted: true, deletedAt: serverTimestamp(), deletedBy: uid, lastAuditId: id }, { action: 'MEMBER_DELETED' });
    await assertFails(suspend('staff', S(), 'c1'));
    await assertFails(suspend('member1', M(), 'c2'));
    await assertFails(del('staff', S(), 'c3'));
    await assertFails(del('member1', M(), 'c4'));
    await assertSucceeds(suspend('admin', A(), 'c5'));
    await assertSucceeds(
      memberUpdate(A(), 'admin', MEM, { suspended: false, suspendedAt: null, suspendedReason: null, suspendedBy: null, lastAuditId: 'c6' }, { action: 'MEMBER_REACTIVATED' }),
    );
    await assertFails(deleteDoc(doc(A(), 'members', MEM))); // never a hard delete
    await assertSucceeds(del('admin', A(), 'c7'));
  });

  it('row 10: Plans view. Admin yes; Staff yes; Member no', async () => {
    await assertSucceeds(getDocs(collection(A(), 'membershipPlans')));
    await assertSucceeds(getDocs(collection(S(), 'membershipPlans')));
    await assertFails(getDocs(collection(M(), 'membershipPlans')));
    await assertFails(getDoc(doc(M(), 'membershipPlans', 'plan1')));
  });

  it('row 11: Plans create / edit / activate / delete. Admin only', async () => {
    const body = (uid: string) => ({ ...planBody({ name: 'Quarterly', nameLower: 'quarterly' }), createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(setDoc(doc(A(), 'membershipPlans', 'p2'), body('admin')));
    await assertSucceeds(updateDoc(doc(A(), 'membershipPlans', 'p2'), { active: false, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(deleteDoc(doc(A(), 'membershipPlans', 'p2')));
    for (const [db, uid] of [[S(), 'staff'], [M(), 'member1']] as const) {
      await assertFails(setDoc(doc(db, 'membershipPlans', 'p3'), body(uid)));
      await assertFails(updateDoc(doc(db, 'membershipPlans', 'plan1'), { active: false, updatedAt: serverTimestamp(), updatedBy: uid }));
      await assertFails(deleteDoc(doc(db, 'membershipPlans', 'plan1')));
    }
  });

  it('row 12: Assign plan / renew. Admin yes; Staff no (money); Member no', async () => {
    const before = { hasMembership: true, endDate: END, pendingPaise: PRICE - 50000 };
    await assertFails(assignCommit(S(), 'staff', { before }));
    await assertFails(assignCommit(M(), 'member1', { before }));
    await assertSucceeds(assignCommit(A(), 'admin', { before }));
  });

  it('row 13: View membership status & expiry. Admin yes; Staff yes; Member own only (and no member can edit an expiry date)', async () => {
    await assertSucceeds(getDoc(doc(A(), 'memberships', 'ms1')));
    await assertSucceeds(getDoc(doc(S(), 'memberships', 'ms1')));
    await assertSucceeds(getDoc(doc(M(), 'memberships', 'ms1')));
    await assertFails(getDoc(doc(M2(), 'memberships', 'ms1')));
    await assertFails(updateDoc(doc(M(), 'memberships', 'ms1'), { endDate: Timestamp.fromMillis(Date.UTC(2031, 0, 1) - 19_800_000) }));
    await assertFails(memberUpdate(M(), 'member1', MEM, { 'membership.endDate': Timestamp.fromMillis(Date.UTC(2031, 0, 1) - 19_800_000), lastAuditId: 'd1' }));
  });

  it('row 14: Record payment. Admin yes; Staff NO (Q10); Member no', async () => {
    await assertFails(paymentCommit(S(), 'staff', { paidBefore: 50000 }));
    await assertFails(paymentCommit(M(), 'member1', { paidBefore: 50000 }));
    await assertSucceeds(paymentCommit(A(), 'admin', { paidBefore: 50000 }));
  });

  it('row 15: View payment history / revenue. Admin yes; Staff NO; Member own payments only', async () => {
    await assertSucceeds(getDocs(collection(A(), 'payments')));
    await assertFails(getDocs(collection(S(), 'payments')));
    await assertFails(getDoc(doc(S(), 'payments', 'p-seed')));
    await assertSucceeds(getDoc(doc(M(), 'payments', 'p-seed')));
    await assertSucceeds(getDocs(query(collection(M(), 'payments'), where('memberDocId', '==', MEM))));
    await assertFails(getDocs(query(collection(M(), 'payments'), where('memberDocId', '==', 'mem2'))));
    await assertFails(getDoc(doc(M2(), 'payments', 'p-seed')));
  });

  it('row 16: See "Amount Pending" on list / profile. Admin yes; Staff yes read-only; Member own', async () => {
    for (const db of [A(), S(), M()]) {
      const snap = await getDoc(doc(db, 'members', MEM));
      if (snap.data()?.pendingPaise !== PRICE - 50000) throw new Error('pendingPaise not readable');
    }
    await assertFails(getDoc(doc(M2(), 'members', MEM)));
    await assertFails(memberUpdate(S(), 'staff', MEM, { pendingPaise: 0, lastAuditId: 'e1' }, { action: 'PAYMENT_CREATED', entity: 'payment' })); // read-only for Staff
    await assertFails(memberUpdate(A(), 'admin', MEM, { pendingPaise: 0, lastAuditId: 'e2' })); // and never edited directly, even by Admin
  });

  it('row 17: Void payment. Admin yes; Staff no; Member no', async () => {
    await assertFails(voidCommit(S(), 'staff'));
    await assertFails(voidCommit(M(), 'member1'));
    await assertSucceeds(voidCommit(A(), 'admin'));
  });

  it('row 18: Attendance mark check-in / check-out / absent. Admin yes; Staff yes; Member no', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`attendance/${MEM}_${istDayKey(new Date())}`).delete();
    });
    const id = `${MEM}_${istDayKey(new Date())}`;
    await assertSucceeds(setDoc(doc(S(), 'attendance', id), attendanceBody('staff')));
    await assertSucceeds(checkOut('staff'));
    await assertFails(setDoc(doc(M(), 'attendance', id), attendanceBody('member1')));
    await assertFails(checkOut('member1'));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`attendance/${id}`).delete();
    });
    await assertSucceeds(setDoc(doc(A(), 'attendance', id), attendanceBody('admin', { status: 'ABSENT', checkInAt: null }))); // Admin: mark absent
  });

  it('row 19: Attendance edit / delete / backdate. Admin may delete; Staff no; nobody edits or backdates', async () => {
    const id = `${MEM}_${istDayKey(new Date())}`;
    await assertFails(updateDoc(doc(A(), 'attendance', id), { status: 'ABSENT', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(S(), 'attendance', id), { status: 'ABSENT', updatedAt: serverTimestamp(), updatedBy: 'staff' }));
    await assertFails(setDoc(doc(A(), 'attendance', `${MEM}_20200101`), attendanceBody('admin', { dateKey: '20200101', date: Timestamp.fromMillis(Date.UTC(2020, 0, 1) - 19_800_000) })));
    await assertFails(deleteDoc(doc(S(), 'attendance', id)));
    await assertFails(deleteDoc(doc(M(), 'attendance', id)));
    await assertSucceeds(deleteDoc(doc(A(), 'attendance', id)));
  });

  it("row 20: Attendance today's list / member history. Admin yes; Staff yes; Member own history only", async () => {
    await assertSucceeds(getDocs(collection(A(), 'attendance')));
    await assertSucceeds(getDocs(collection(S(), 'attendance')));
    await assertSucceeds(getDocs(query(collection(M(), 'attendance'), where('memberDocId', '==', MEM))));
    await assertFails(getDocs(query(collection(M(), 'attendance'), where('memberDocId', '==', 'mem2'))));
    await assertFails(getDocs(collection(M(), 'attendance')));
  });

  it('row 21: Dashboard. Admin full (member, attendance AND money aggregations); Staff non-financial only (no payments aggregation); Member none', async () => {
    const members = (db: ReturnType<typeof dbFor>) => getCountFromServer(liveMembers(db));
    const attendance = (db: ReturnType<typeof dbFor>) => getCountFromServer(query(collection(db, 'attendance'), where('status', '==', 'PRESENT')));
    const revenue = (db: ReturnType<typeof dbFor>) => getAggregateFromServer(query(collection(db, 'payments'), where('voided', '==', false)), { total: sum('amountPaise'), n: count() });
    await assertSucceeds(members(A()));
    await assertSucceeds(attendance(A()));
    await assertSucceeds(revenue(A()));
    await assertSucceeds(members(S()));
    await assertSucceeds(attendance(S()));
    await assertFails(revenue(S()));
    await assertFails(members(M()));
    await assertFails(attendance(M()));
    await assertFails(revenue(M()));
  });

  it('row 22: Reports & CSV. Admin only: Staff cannot read payments, medical notes or write the REPORT_EXPORTED audit; Member nothing', async () => {
    const exported = (uid: string) =>
      auditBody(uid, 'REPORT_EXPORTED', 'report', 'MEMBERS', { metadata: { report: 'MEMBERS', from: 'any', to: 'any', rowCount: 3, truncated: false, rowCap: 5000 } });
    await assertSucceeds(setDoc(doc(A(), 'auditLogs', 'r1'), exported('admin')));
    await assertFails(setDoc(doc(S(), 'auditLogs', 'r2'), exported('staff')));
    await assertFails(setDoc(doc(M(), 'auditLogs', 'r3'), exported('member1')));
    await assertFails(getDocs(collection(S(), 'payments')));
    await assertFails(getDoc(doc(S(), 'memberMedical', MEM)));
    // a personal value smuggled into the export record is refused even for an Admin
    await assertFails(setDoc(doc(A(), 'auditLogs', 'r4'), auditBody('admin', 'REPORT_EXPORTED', 'report', 'MEMBERS', { metadata: { report: 'MEMBERS', from: 'any', to: 'any', rowCount: 3, truncated: false, rowCap: 5000, name: 'Rahul' } })));
  });

  it('row 23: Trainers. Admin manage; Staff read; Member no', async () => {
    const body = (uid: string) => ({ name: 'Priya', mobile: '9876543210', active: true, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(getDocs(collection(A(), 'trainers')));
    await assertSucceeds(getDocs(collection(S(), 'trainers')));
    await assertFails(getDocs(collection(M(), 'trainers')));
    await assertFails(getDoc(doc(M(), 'trainers', 't1')));
    await assertSucceeds(setDoc(doc(A(), 'trainers', 't2'), body('admin')));
    await assertSucceeds(updateDoc(doc(A(), 'trainers', 't2'), { active: false, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(deleteDoc(doc(A(), 'trainers', 't2')));
    for (const [db, uid] of [[S(), 'staff'], [M(), 'member1']] as const) {
      await assertFails(setDoc(doc(db, 'trainers', 't3'), body(uid)));
      await assertFails(updateDoc(doc(db, 'trainers', 't1'), { active: false, updatedAt: serverTimestamp(), updatedBy: uid }));
      await assertFails(deleteDoc(doc(db, 'trainers', 't1')));
    }
  });

  it('row 24: Settings. The Settings page is read-only and has NO document: `settings` and `notifications` are denied to every role (deviation, documented)', async () => {
    for (const db of [A(), S(), M(), ANON()]) {
      await assertFails(getDoc(doc(db, 'settings', 'app')));
      await assertFails(setDoc(doc(db, 'settings', 'app'), { gymName: 'x' }));
      await assertFails(getDoc(doc(db, 'notifications', 'n1')));
    }
  });

  it('row 25: Audit log create (as part of an action). Admin yes; Staff yes (for actions they may perform); Member no', async () => {
    await assertSucceeds(setDoc(doc(A(), 'auditLogs', 'n1'), auditBody('admin', 'MEMBER_UPDATED', 'member', MEM)));
    await assertSucceeds(setDoc(doc(S(), 'auditLogs', 'n2'), auditBody('staff', 'MEMBER_CREATED', 'member', MEM)));
    await assertFails(setDoc(doc(M(), 'auditLogs', 'n3'), auditBody('member1', 'MEMBER_UPDATED', 'member', MEM)));
    await assertFails(setDoc(doc(S(), 'auditLogs', 'n4'), auditBody('admin', 'MEMBER_UPDATED', 'member', MEM))); // cannot write as someone else
  });

  it('row 26: Audit log read / update / delete. Read: Admin only; update and delete: never, for anyone', async () => {
    await assertSucceeds(getDoc(doc(A(), 'auditLogs', 'a1')));
    await assertSucceeds(getDocs(collection(A(), 'auditLogs')));
    await assertFails(getDoc(doc(S(), 'auditLogs', 'a1')));
    await assertFails(getDoc(doc(M(), 'auditLogs', 'a1')));
    await assertFails(getDocs(collection(S(), 'auditLogs')));
    for (const db of [A(), S(), M(), ANON()]) {
      await assertFails(updateDoc(doc(db, 'auditLogs', 'a1'), { entityLabel: 'tampered' }));
      await assertFails(setDoc(doc(db, 'auditLogs', 'a1'), auditBody('admin', 'MEMBER_CREATED', 'member', MEM)));
      await assertFails(deleteDoc(doc(db, 'auditLogs', 'a1')));
    }
  });
});
