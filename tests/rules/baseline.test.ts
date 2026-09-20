import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { COLLECTION_PATHS, createTestEnv, seedUsers } from './setup';

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

describe('baseline: unauthenticated access is denied everywhere (AC-10, US-1.9a)', () => {
  for (const collection of COLLECTION_PATHS) {
    it(`anon cannot read or write /${collection}`, async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(db.doc(`${collection}/x`).get());
      await assertFails(db.collection(collection).get());
      await assertFails(db.doc(`${collection}/x`).set({ a: 1 }));
      await assertFails(db.collection(collection).add({ a: 1 }));
      await assertFails(db.doc(`${collection}/x`).delete());
    });
  }

  it('anon cannot read even an existing users doc', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.doc('users/admin').get());
  });

  it('anon cannot use a collection-group query', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collectionGroup('users').get());
  });
});

describe('baseline: unlisted paths are denied (US-1.9d)', () => {
  it('signed-in user cannot read or write an unlisted top-level path', async () => {
    const db = env.authenticatedContext('admin').firestore();
    await assertFails(db.doc('foo/bar').get());
    await assertFails(db.doc('foo/bar').set({ a: 1 }));
  });

  it('signed-in user cannot read or write a subcollection under their own users doc', async () => {
    const db = env.authenticatedContext('admin').firestore();
    await assertFails(db.doc('users/admin/secrets/s1').get());
    await assertFails(db.doc('users/admin/secrets/s1').set({ a: 1 }));
  });

  it('signed-in user cannot run a collection-group query over users', async () => {
    const db = env.authenticatedContext('admin').firestore();
    await assertFails(db.collectionGroup('users').get());
  });

  it('signed-in user cannot list the users collection', async () => {
    const db = env.authenticatedContext('admin').firestore();
    await assertFails(db.collection('users').get());
  });
});

describe('baseline: signed-in users without a role doc, or with an inactive one', () => {
  it('noRole (no users doc) is denied on every business collection but may attempt its own users doc read', async () => {
    const db = env.authenticatedContext('noRole').firestore();
    for (const collection of COLLECTION_PATHS.filter((c) => c !== 'users')) {
      await assertFails(db.doc(`${collection}/x`).get());
      await assertFails(db.doc(`${collection}/x`).set({ a: 1 }));
    }
    // Own doc read is permitted by the rule; the doc simply does not exist.
    await assertSucceeds(db.doc('users/noRole').get());
  });

  it('inactive user is denied on every business collection but can read its own users doc', async () => {
    const db = env.authenticatedContext('inactive').firestore();
    for (const collection of COLLECTION_PATHS.filter((c) => c !== 'users')) {
      await assertFails(db.doc(`${collection}/x`).get());
    }
    await assertSucceeds(db.doc('users/inactive').get());
  });

  it('even an ADMIN users doc grants nothing on collections that have no client writer or reader (notifications, settings) (deny by default)', async () => {
    // Phase 2 added per-collection rules for members/memberMedical/memberPhotos/trainers/counters/auditLogs, Phase 3 for
    // membershipPlans/memberships, Phase 4 for payments and Phase 5 for attendance (see the dedicated test files). The former
    // mobile-lock collection is gone. Phase 7: `notifications` stays denied to every client (no writer, NEW-21) and so does `settings`
    // (the Settings page is read-only and has no document).
    const db = env.authenticatedContext('admin').firestore();
    for (const path of ['memberMobiles/9876543210', 'settings/app', 'notifications/n1']) {
      await assertFails(db.doc(path).get());
      await assertFails(db.doc(path).set({ a: 1 }));
    }
    await assertFails(db.doc('members/m1/sub/x').set({ a: 1 })); // subcollections of Phase 2 docs are denied too
    await assertFails(db.doc('memberships/m1/sub/x').set({ a: 1 }));
    await assertFails(db.doc('membershipPlans/p1/sub/x').set({ a: 1 }));
    await assertFails(db.doc('payments/p1/sub/x').set({ a: 1 }));
    await assertFails(db.doc('attendance/a1/sub/x').set({ a: 1 }));
  });

  it('attendance (Phase 5): an arbitrary write is refused even for an Admin or Staff (only the shaped check-in / absent / check-out commits pass; see the service rules run), a Member cannot write', async () => {
    for (const uid of ['admin', 'staff', 'member1']) {
      await assertFails(env.authenticatedContext(uid).firestore().doc('attendance/mem1_20260101').set({ a: 1 }));
    }
    await assertSucceeds(env.authenticatedContext('staff').firestore().collection('attendance').get());
  });

  it('payments (Phase 4) are Admin-only: an arbitrary write is refused even for an Admin, and Staff and Member can neither read nor write', async () => {
    // a payment can only be created together with the membership / member updates that explain it (see the payments suite)
    await assertFails(env.authenticatedContext('admin').firestore().doc('payments/p1').set({ a: 1 }));
    for (const uid of ['staff', 'member1']) {
      const db = env.authenticatedContext(uid).firestore();
      await assertFails(db.doc('payments/p1').get());
      await assertFails(db.collection('payments').get());
      await assertFails(db.doc('payments/p1').set({ a: 1 }));
    }
    await assertSucceeds(env.authenticatedContext('admin').firestore().collection('payments').get());
  });
});
