import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
    await setDoc(doc(ctx.firestore() as never, 'auditLogs', 'a1'), {
      actorUid: 'admin', actorName: 'T', actorRole: 'ADMIN', action: 'MEMBER_CREATED', entity: 'member',
      entityId: 'mem1', entityLabel: 'GYM-2026-0001 Rahul', at: Timestamp.now(), metadata: {},
    });
  });
});

const entry = (uid: string, role: string, over: Record<string, unknown> = {}) => ({
  actorUid: uid, actorName: 'Tester', actorRole: role, action: 'MEMBER_UPDATED', entity: 'member',
  entityId: 'mem1', entityLabel: 'GYM-2026-0001 Rahul Sharma', at: serverTimestamp(),
  metadata: { changedFields: 'address' }, ...over,
});

describe('auditLogs are append-only (US-2.14c)', () => {
  it('ADMIN and STAFF can create their own audit record', async () => {
    await assertSucceeds(setDoc(doc(dbFor(env, 'admin'), 'auditLogs', 'n1'), entry('admin', 'ADMIN')));
    await assertSucceeds(setDoc(doc(dbFor(env, 'staff'), 'auditLogs', 'n2'), entry('staff', 'STAFF', { action: 'MEMBER_CREATED' })));
  });

  it('cannot be forged: another actor uid, another role, a client-clock time', async () => {
    await assertFails(setDoc(doc(dbFor(env, 'staff'), 'auditLogs', 'n1'), entry('admin', 'ADMIN')));
    await assertFails(setDoc(doc(dbFor(env, 'staff'), 'auditLogs', 'n1'), entry('staff', 'ADMIN')));
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'auditLogs', 'n1'), entry('admin', 'ADMIN', { at: Timestamp.fromDate(new Date('2020-01-01')) })));
  });

  it.each([
    ['an unknown action', { action: 'MEMBER_EXPLODED' }],
    ['an unknown entity', { entity: 'secrets' }],
    ['a non-map metadata', { metadata: 'text' }],
    ['a non-string entityId', { entityId: 5 }],
    ['an extra field', { extra: 1 }],
  ])('create with %s is denied', async (_label, over) => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'auditLogs', 'n1'), entry('admin', 'ADMIN', over)));
  });

  it('MEMBER, anonymous, role-less and inactive users cannot create', async () => {
    for (const uid of ['member1', 'noRole', 'inactive']) {
      await assertFails(setDoc(doc(dbFor(env, uid), 'auditLogs', 'n1'), entry(uid, 'ADMIN')));
    }
    await assertFails(setDoc(doc(dbFor(env, null), 'auditLogs', 'n1'), entry('x', 'ADMIN')));
  });

  it('update and delete are denied for EVERYONE, including the ADMIN who wrote the record', async () => {
    for (const uid of ['admin', 'staff']) {
      const db = dbFor(env, uid);
      await assertFails(updateDoc(doc(db, 'auditLogs', 'a1'), { entityLabel: 'tampered' }));
      await assertFails(setDoc(doc(db, 'auditLogs', 'a1'), entry(uid, 'ADMIN')));
      await assertFails(deleteDoc(doc(db, 'auditLogs', 'a1')));
    }
  });

  it('read is Admin only (staff denied)', async () => {
    await assertSucceeds(getDoc(doc(dbFor(env, 'admin'), 'auditLogs', 'a1')));
    await assertFails(getDoc(doc(dbFor(env, 'staff'), 'auditLogs', 'a1')));
    await assertFails(getDoc(doc(dbFor(env, 'member1'), 'auditLogs', 'a1')));
  });
});
