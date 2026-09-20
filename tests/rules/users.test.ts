import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv, seedUsers } from './setup';

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

describe('users/{uid} read access (US-1.9b)', () => {
  it('a signed-in user can read their own doc', async () => {
    await assertSucceeds(env.authenticatedContext('admin').firestore().doc('users/admin').get());
    await assertSucceeds(env.authenticatedContext('staff').firestore().doc('users/staff').get());
    await assertSucceeds(env.authenticatedContext('member1').firestore().doc('users/member1').get());
  });

  it("a signed-in user cannot read someone else's doc (incl. admin reading staff)", async () => {
    await assertFails(env.authenticatedContext('staff').firestore().doc('users/admin').get());
    await assertFails(env.authenticatedContext('member1').firestore().doc('users/staff').get());
    await assertFails(env.authenticatedContext('admin').firestore().doc('users/staff').get());
  });

  it('list/query of users is denied for everyone', async () => {
    await assertFails(env.authenticatedContext('admin').firestore().collection('users').get());
    await assertFails(
      env.authenticatedContext('admin').firestore().collection('users').where('role', '==', 'ADMIN').get(),
    );
  });
});

describe('users/{uid} write access: role forgery is impossible (AC-12, US-1.9c)', () => {
  const forged = { email: 'x@example.com', displayName: 'X', role: 'ADMIN', active: true };

  it('a signed-in user with NO users doc cannot create their own doc with role ADMIN', async () => {
    const db = env.authenticatedContext('noRole').firestore();
    await assertFails(db.doc('users/noRole').set(forged));
  });

  it('a STAFF user cannot update their own role to ADMIN', async () => {
    const db = env.authenticatedContext('staff').firestore();
    await assertFails(db.doc('users/staff').update({ role: 'ADMIN' }));
    await assertFails(db.doc('users/staff').set({ ...forged, email: 'staff@example.com' }));
  });

  it('a MEMBER user cannot update their own role or link themselves to another member', async () => {
    const db = env.authenticatedContext('member1').firestore();
    await assertFails(db.doc('users/member1').update({ role: 'ADMIN' }));
    await assertFails(db.doc('users/member1').update({ memberDocId: 'mem2' }));
  });

  it('an inactive user cannot re-activate themselves', async () => {
    const db = env.authenticatedContext('inactive').firestore();
    await assertFails(db.doc('users/inactive').update({ active: true }));
  });

  it('even an ADMIN cannot write any users doc from a client (console only)', async () => {
    const db = env.authenticatedContext('admin').firestore();
    await assertFails(db.doc('users/admin').update({ displayName: 'Changed' }));
    await assertFails(db.doc('users/newUser').set(forged));
    await assertFails(db.doc('users/staff').update({ role: 'ADMIN' }));
  });

  it('nobody can delete a users doc', async () => {
    await assertFails(env.authenticatedContext('admin').firestore().doc('users/admin').delete());
    await assertFails(env.authenticatedContext('staff').firestore().doc('users/staff').delete());
  });

  it('anonymous users cannot write users docs', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.doc('users/anon').set(forged));
  });

  it('the seeded docs are unchanged after all denied writes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await ctx.firestore().doc('users/staff').get();
      if (snap.data()?.role !== 'STAFF') throw new Error('staff role was modified');
    });
  });
});
