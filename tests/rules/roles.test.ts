import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getCountFromServer, getDoc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { istDayKey, todayIstStart } from '../../src/domain/dates';
import { assignCommit, MEM, MEMBER_ID_TEXT, paymentCommit, planBody, seedMemberWithMembership, voidCommit } from './fixtures';
import { auditBody, BROKEN_ROLE_UIDS, COLLECTION_PATHS, createTestEnv, dbFor, registerBatch, seedMember, seedUsers } from './setup';

/**
 * US-8.2b: a user whose `users` document is missing or malformed (unknown / lower-case / padded / null / array role, missing or
 * non-boolean `active`, inactive) is denied ALL app data access, for reads and for every kind of write, even when the write is
 * exactly what an Admin would be allowed to do. Roles are compared exactly and come only from users/{uid}: a role in the auth
 * token (custom claims cannot be set without the Admin SDK, but a forged token claim must still be ignored) changes nothing.
 */
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

type Db = ReturnType<typeof dbFor>;

/** Every kind of write an Admin may legitimately do, as a rule-valid commit made by `uid`. `seed` prepares the pre-state. */
interface Op {
  name: string;
  seed: () => Promise<void>;
  run: (db: Db, uid: string) => Promise<unknown>;
}

const attendanceBody = (uid: string) => ({
  memberDocId: MEM, memberId: MEMBER_ID_TEXT, memberName: 'Rahul Sharma', date: Timestamp.fromDate(todayIstStart()), dateKey: istDayKey(new Date()),
  status: 'PRESENT', checkInAt: serverTimestamp(), checkOutAt: null, checkedOut: false,
  createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid,
});

const OPS: Op[] = [
  { name: 'register a member', seed: async () => undefined, run: (db, uid) => registerBatch(db, { uid }).commit() },
  {
    name: 'create a plan',
    seed: async () => undefined,
    run: (db, uid) =>
      setDoc(doc(db, 'membershipPlans', 'p9'), { ...planBody(), createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid }),
  },
  {
    name: 'create a trainer',
    seed: async () => undefined,
    run: (db, uid) =>
      setDoc(doc(db, 'trainers', 't9'), { name: 'Amit', mobile: null, active: true, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid }),
  },
  {
    name: 'write an audit record',
    seed: async () => undefined,
    run: (db, uid) => setDoc(doc(db, 'auditLogs', 'x1'), auditBody(uid, 'PLAN_CREATED', 'plan', 'p1')),
  },
  { name: 'check a member in', seed: () => seedMember(env, { docId: MEM }).then(() => undefined), run: (db, uid) => setDoc(doc(db, 'attendance', `${MEM}_${istDayKey(new Date())}`), attendanceBody(uid)) },
  {
    name: 'write medical notes',
    seed: () => seedMember(env, { docId: MEM }).then(() => undefined),
    run: (db, uid) => setDoc(doc(db, 'memberMedical', MEM), { notes: 'asthma', updatedAt: serverTimestamp(), updatedBy: uid }),
  },
  {
    name: 'assign a membership',
    seed: async () => {
      await seedMember(env, { docId: MEM });
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as never, 'membershipPlans', 'plan1'), planBody());
      });
    },
    run: (db, uid) => assignCommit(db, uid),
  },
  { name: 'record a payment', seed: () => seedMemberWithMembership(env), run: (db, uid) => paymentCommit(db, uid) },
  { name: 'void a payment', seed: () => seedMemberWithMembership(env, { paidPaise: 50000 }), run: (db, uid) => voidCommit(db, uid) },
];

/** A little of everything, so reads have something to be denied. */
async function seedEverything() {
  await seedMemberWithMembership(env, { paidPaise: 50000 });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as never;
    await setDoc(doc(db, 'memberMedical', MEM), { notes: 'asthma', updatedAt: Timestamp.now(), updatedBy: 'admin' });
    await setDoc(doc(db, 'trainers', 't1'), { name: 'Amit', mobile: null, active: true, createdAt: Timestamp.now(), createdBy: 'admin', updatedAt: Timestamp.now(), updatedBy: 'admin' });
    await setDoc(doc(db, 'auditLogs', 'a1'), { ...auditBody('admin', 'MEMBER_CREATED', 'member', MEM), at: Timestamp.now() });
    await setDoc(doc(db, 'attendance', `${MEM}_20260101`), { ...attendanceBody('admin'), checkInAt: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
}

describe('control: the SAME writes succeed for a well-formed ADMIN (so the denials below are about the role, nothing else)', () => {
  for (const op of OPS) {
    it(`ADMIN can ${op.name}`, async () => {
      await env.clearFirestore();
      await seedUsers(env);
      await op.seed();
      await assertSucceeds(op.run(dbFor(env, 'admin'), 'admin'));
    });
  }
});

describe('US-8.2b: missing / unknown-role / inactive users are denied everywhere', () => {
  beforeEach(async () => {
    await env.clearFirestore();
    await seedUsers(env);
    await seedEverything();
  });

  for (const uid of BROKEN_ROLE_UIDS) {
    it(`${uid}: every read (get, list, count) of every app collection is denied`, async () => {
      const db = dbFor(env, uid);
      for (const c of COLLECTION_PATHS.filter((p) => p !== 'users')) {
        await assertFails(getDoc(doc(db, c, 'x')));
        await assertFails(getDocs(collection(db, c)));
      }
      for (const [c, id] of [['members', MEM], ['memberMedical', MEM], ['memberships', 'ms1'], ['payments', 'p-seed'], ['auditLogs', 'a1'], ['trainers', 't1'], ['membershipPlans', 'plan1'], ['counters', 'memberId-2026']] as const) {
        await assertFails(getDoc(doc(db, c, id)));
      }
      await assertFails(getCountFromServer(collection(db, 'members')));
      await assertFails(getCountFromServer(collection(db, 'payments')));
      await assertFails(getCountFromServer(collection(db, 'attendance')));
    });

    it(`${uid}: cannot read another user's users doc, list users, or forge a role`, async () => {
      const db = dbFor(env, uid);
      await assertFails(getDoc(doc(db, 'users', 'admin')));
      await assertFails(getDocs(collection(db, 'users')));
      await assertFails(setDoc(doc(db, 'users', uid), { email: 'x@example.com', displayName: 'X', role: 'ADMIN', active: true }));
      await assertFails(setDoc(doc(db, 'users', 'admin'), { role: 'ADMIN', active: true }));
    });
  }

  for (const op of OPS) {
    it(`no broken-role user can ${op.name} (a commit an Admin is allowed to make)`, async () => {
      for (const uid of BROKEN_ROLE_UIDS) {
        await env.clearFirestore();
        await seedUsers(env);
        await op.seed();
        await assertFails(op.run(dbFor(env, uid), uid));
      }
    });
  }

  it('anonymous users are denied the same writes', async () => {
    for (const op of OPS) {
      await env.clearFirestore();
      await seedUsers(env);
      await op.seed();
      await assertFails(op.run(dbFor(env, null), 'anon'));
    }
  });
});

describe('role forgery through the auth token is ignored (roles come only from users/{uid})', () => {
  beforeEach(async () => {
    await env.clearFirestore();
    await seedUsers(env);
    await seedEverything();
  });

  it('a token that CLAIMS role ADMIN / admin: true does not make a role-less or MEMBER user an admin', async () => {
    for (const uid of ['noRole', 'member1', 'unknownRole']) {
      const db = env.authenticatedContext(uid, { role: 'ADMIN', admin: true, roles: ['ADMIN'] }).firestore();
      await assertFails(db.collection('payments').get());
      await assertFails(db.doc('memberMedical/mem1').get());
      await assertFails(db.collection('auditLogs').get());
      await assertFails(db.doc('members/mem1').update({ address: 'x' }));
      await assertFails(db.doc(`users/${uid}`).set({ role: 'ADMIN', active: true }));
    }
  });

  it('a STAFF token claiming ADMIN still gets Staff rights only', async () => {
    const db = env.authenticatedContext('staff', { role: 'ADMIN' }).firestore();
    await assertFails(db.collection('payments').get());
    await assertFails(db.doc('memberMedical/mem1').get());
    await assertSucceeds(db.doc('membershipPlans/plan1').get());
  });

  it('an ADMIN users doc whose role is deactivated later loses access immediately (active is checked on every request)', async () => {
    await assertSucceeds(getDocs(collection(dbFor(env, 'admin'), 'payments')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('users/admin').update({ active: false });
    });
    await assertFails(getDocs(collection(dbFor(env, 'admin'), 'payments')));
    await assertFails(getDoc(doc(dbFor(env, 'admin'), 'members', MEM)));
  });
});
