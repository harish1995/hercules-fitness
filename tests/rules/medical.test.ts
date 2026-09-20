import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv, dbFor, seedMember, seedUsers } from './setup';

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
  await seedMember(env, { docId: 'mem1' });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'memberMedical', 'mem1'), { notes: 'asthma', updatedAt: Timestamp.now(), updatedBy: 'admin' });
  });
});

const write = (uid: string, notes: unknown, extra: Record<string, unknown> = {}) =>
  setDoc(doc(dbFor(env, uid), 'memberMedical', 'mem1'), { notes, updatedAt: serverTimestamp(), updatedBy: uid, ...extra });

describe('memberMedical is ADMIN ONLY (US-2.6b, compliance)', () => {
  it('ADMIN can read, write and delete', async () => {
    await assertSucceeds(getDoc(doc(dbFor(env, 'admin'), 'memberMedical', 'mem1')));
    await assertSucceeds(write('admin', 'knee injury'));
    await assertSucceeds(deleteDoc(doc(dbFor(env, 'admin'), 'memberMedical', 'mem1')));
  });

  it('STAFF can neither read nor write nor delete', async () => {
    const staff = dbFor(env, 'staff');
    await assertFails(getDoc(doc(staff, 'memberMedical', 'mem1')));
    await assertFails(write('staff', 'x'));
    await assertFails(deleteDoc(doc(staff, 'memberMedical', 'mem1')));
  });

  it('a MEMBER (even the linked one), anonymous, role-less and inactive users are denied everything', async () => {
    for (const uid of ['member1', null, 'noRole', 'inactive']) {
      const db = dbFor(env, uid);
      await assertFails(getDoc(doc(db, 'memberMedical', 'mem1')));
      await assertFails(setDoc(doc(db, 'memberMedical', 'mem1'), { notes: 'x', updatedAt: serverTimestamp(), updatedBy: uid ?? 'x' }));
    }
  });

  it('medical notes can only be written for a member that exists (A3)', async () => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'memberMedical', 'ghost'), { notes: 'x', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('notes must be a 1-1000 character string with only the allowed fields', async () => {
    await assertFails(write('admin', ''));
    await assertFails(write('admin', 'x'.repeat(1001)));
    await assertSucceeds(write('admin', 'x'.repeat(1000)));
    await assertFails(write('admin', 42));
    await assertFails(write('admin', 'ok', { extra: 1 }));
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'memberMedical', 'mem1'), { notes: 'ok', updatedAt: serverTimestamp(), updatedBy: 'staff' }));
  });
});
