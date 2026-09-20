import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { PLAN, planBody } from './fixtures';
import { BROKEN_ROLE_UIDS, createTestEnv, dbFor, seedUsers } from './setup';

/** Permission Matrix rows: "Plans: view" (Admin yes, Staff yes, Member no) and "Plans: create/edit/activate/delete" (Admin only). */
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
    await setDoc(doc(ctx.firestore() as never, 'membershipPlans', PLAN), planBody());
  });
});

/** What the app writes (planBody in planTransactions.ts): server times for updatedAt / createdAt. */
const body = (uid: string, over: Record<string, unknown> = {}) => ({
  name: 'Quarterly', nameLower: 'quarterly', durationValue: 3, durationUnit: 'MONTHS', pricePaise: 400000, description: 'Three months', active: true,
  createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid, ...over,
});
const create = (uid: string | null, over: Record<string, unknown> = {}) => setDoc(doc(dbFor(env, uid), 'membershipPlans', 'plan2'), body(uid ?? 'x', over));
const edit = (uid: string, fields: Record<string, unknown>) =>
  setDoc(doc(dbFor(env, uid), 'membershipPlans', PLAN), { ...planBody({ createdAt: undefined, updatedAt: serverTimestamp(), updatedBy: uid }), createdAt: Timestamp.now(), ...fields });

describe('plans: view (matrix: Admin yes, Staff yes, Member no)', () => {
  it('ADMIN and STAFF can get and list', async () => {
    for (const uid of ['admin', 'staff']) {
      await assertSucceeds(getDoc(doc(dbFor(env, uid), 'membershipPlans', PLAN)));
      await assertSucceeds(getDocs(collection(dbFor(env, uid), 'membershipPlans')));
    }
  });

  it('MEMBER, anonymous and every broken-role user are denied', async () => {
    for (const uid of ['member1', 'member2', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(getDoc(doc(dbFor(env, uid), 'membershipPlans', PLAN)));
      await assertFails(getDocs(collection(dbFor(env, uid), 'membershipPlans')));
    }
  });
});

describe('plans: create / edit / activate / delete (matrix: Admin only)', () => {
  it('ADMIN can create, edit (incl. deactivate) and delete', async () => {
    await assertSucceeds(create('admin'));
    await assertSucceeds(updateDoc(doc(dbFor(env, 'admin'), 'membershipPlans', PLAN), { pricePaise: 200000, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(updateDoc(doc(dbFor(env, 'admin'), 'membershipPlans', PLAN), { active: false, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(deleteDoc(doc(dbFor(env, 'admin'), 'membershipPlans', PLAN)));
  });

  it('STAFF, MEMBER, anonymous and broken-role users can do none of them', async () => {
    for (const uid of ['staff', 'member1', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(create(uid));
      await assertFails(updateDoc(doc(dbFor(env, uid), 'membershipPlans', PLAN), { active: false, updatedAt: serverTimestamp(), updatedBy: uid ?? 'x' }));
      await assertFails(deleteDoc(doc(dbFor(env, uid), 'membershipPlans', PLAN)));
    }
  });

  it.each([
    ['a price of 0 (a free plan is not supported, FR-3)', { pricePaise: 0 }],
    ['a negative price', { pricePaise: -100 }],
    ['a fractional / float price', { pricePaise: 1500.5 }],
    ['a price as a string', { pricePaise: '1500' }],
    ['a price above the cap', { pricePaise: 100000000001 }],
    ['a duration of 0', { durationValue: 0 }],
    ['a fractional duration', { durationValue: 1.5 }],
    ['more than 120 months', { durationValue: 121 }],
    ['more than 3650 days', { durationValue: 3651, durationUnit: 'DAYS' }],
    ['an unknown duration unit', { durationUnit: 'YEARS' }],
    ['an empty name', { name: '', nameLower: '' }],
    ['a 61-character name', { name: 'x'.repeat(61), nameLower: 'x'.repeat(61) }],
    ['nameLower that does not match an ASCII name', { nameLower: 'other' }],
    ['a description over 300 characters', { description: 'x'.repeat(301) }],
    ['active that is not a boolean', { active: 'yes' }],
    ['an unknown extra field', { role: 'ADMIN' }],
    ['a client-clock updatedAt', { updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }],
    ['a spoofed updatedBy', { updatedBy: 'staff' }],
  ])('create with %s is denied even for an Admin', async (_label, over) => {
    await assertFails(create('admin', over));
  });

  it('createdAt / createdBy are immutable on edit, and a spoofed createdBy on create is denied', async () => {
    await assertFails(create('admin', { createdBy: 'staff' }));
    await assertFails(edit('admin', { createdBy: 'staff' }));
    await assertFails(edit('admin', { createdAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  });
});
