import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDocs, collection, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv, dbFor, seedUsers } from './setup';

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
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'trainers', 't1'), {
      name: 'Amit', mobile: null, active: true,
      createdAt: Timestamp.now(), createdBy: 'admin', updatedAt: Timestamp.now(), updatedBy: 'admin',
    });
  });
});

const body = (uid: string, over: Record<string, unknown> = {}) => ({
  name: 'Priya', mobile: '9876543210', active: true,
  createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid, ...over,
});

describe('trainers (NEW-2, matrix: Admin manage / Staff read)', () => {
  it('ADMIN and STAFF can read', async () => {
    await assertSucceeds(getDocs(collection(dbFor(env, 'admin'), 'trainers')));
    await assertSucceeds(getDocs(collection(dbFor(env, 'staff'), 'trainers')));
  });

  it('anonymous, role-less and inactive users cannot read', async () => {
    for (const uid of [null, 'noRole', 'inactive']) await assertFails(getDocs(collection(dbFor(env, uid), 'trainers')));
  });

  it('ADMIN can create, update and delete', async () => {
    const admin = dbFor(env, 'admin');
    await assertSucceeds(setDoc(doc(admin, 'trainers', 't2'), body('admin')));
    await assertSucceeds(updateDoc(doc(admin, 'trainers', 't1'), { name: 'Amit K', active: false, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(deleteDoc(doc(admin, 'trainers', 't1')));
  });

  it('STAFF and MEMBER cannot write', async () => {
    for (const uid of ['staff', 'member1']) {
      const db = dbFor(env, uid);
      await assertFails(setDoc(doc(db, 'trainers', 't2'), body(uid)));
      await assertFails(updateDoc(doc(db, 'trainers', 't1'), { active: false, updatedAt: serverTimestamp(), updatedBy: uid }));
      await assertFails(deleteDoc(doc(db, 'trainers', 't1')));
    }
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['an invalid mobile', { mobile: '123' }],
    ['a non-boolean active', { active: 'yes' }],
    ['a spoofed createdBy', { createdBy: 'staff' }],
    ['an extra field', { role: 'ADMIN' }],
  ])('create with %s is denied', async (_label, over) => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'trainers', 't2'), body('admin', over)));
  });

  it('createdAt/createdBy cannot be rewritten on update', async () => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'trainers', 't1'), body('admin', { createdBy: 'staff' })));
  });
});
