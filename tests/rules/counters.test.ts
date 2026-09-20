import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { addAudit, createTestEnv, currentYear, dbFor, memberData, padSeq, seedUsers } from './setup';

let env: RulesTestEnvironment;
const year = currentYear();
const path = `memberId-${year}`;
// Every counter write must name the ONE new member created in the same commit, so the helper writes both.
const counter = (uid: string, data: Record<string, unknown>, id = path) => {
  const db = dbFor(env, uid);
  const seq = typeof data.lastSeq === 'number' ? data.lastSeq : 1;
  const batch = writeBatch(db);
  batch.set(doc(db, 'counters', id), { updatedAt: serverTimestamp(), updatedBy: uid, lastMemberDocId: 'newMem', ...data });
  batch.set(doc(db, 'members', 'newMem'), memberData({ uid, seq, mobile: '9123456780', year, overrides: { memberId: `GYM-${year}-${padSeq(seq)}` } }));
  addAudit(batch, db, uid, 'audit1', 'MEMBER_CREATED', 'member', 'newMem');
  return batch.commit();
};

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

async function seedCounter(lastSeq: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'counters', path), { year, lastSeq, lastMemberDocId: 'prev', updatedAt: Timestamp.now(), updatedBy: 'admin' });
  });
}

describe('counters: create (first registration of a year)', () => {
  it('lastSeq 1 is allowed for staff and admin', async () => {
    await assertSucceeds(counter('staff', { year, lastSeq: 1 }));
  });

  it.each([
    ['lastSeq 2 (skipping)', { lastSeq: 2 }],
    ['lastSeq 0', { lastSeq: 0 }],
    ['a string lastSeq', { lastSeq: '1' }],
    ['a different year in the body', { year: year - 1, lastSeq: 1 }],
    ['an extra field', { lastSeq: 1, extra: true }],
  ])('%s is denied', async (_label, data) => {
    await assertFails(counter('admin', { year, ...data }));
  });

  it('a doc id that does not match the year is denied; far-off years are denied', async () => {
    await assertFails(counter('admin', { year, lastSeq: 1 }, 'memberId-1999'));
    await assertFails(counter('admin', { year: year + 5, lastSeq: 1 }, `memberId-${year + 5}`));
    await assertFails(counter('admin', { year, lastSeq: 1 }, 'somethingElse'));
  });

  it('member, anonymous, role-less and inactive users cannot create', async () => {
    for (const uid of ['member1', 'noRole', 'inactive']) await assertFails(counter(uid, { year, lastSeq: 1 }));
    await assertFails(setDoc(doc(dbFor(env, null), 'counters', path), { year, lastSeq: 1, lastMemberDocId: 'newMem', updatedAt: serverTimestamp(), updatedBy: 'x' }));
  });
});

describe('counters: update is +1 only', () => {
  beforeEach(async () => {
    await seedCounter(5);
  });

  it('lastSeq + 1 is allowed', async () => {
    await assertSucceeds(counter('staff', { year, lastSeq: 6 }));
  });

  it.each([
    ['+2', 7],
    ['unchanged', 5],
    ['a decrement', 4],
    ['a reset to 1', 1],
    ['an arbitrary value', 999],
  ])('%s is denied', async (_label, lastSeq) => {
    await assertFails(counter('admin', { year, lastSeq }));
  });

  it('a counter update that names no new member (or a missing lastMemberDocId) is denied', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, 'admin'), 'counters', path), { year, lastSeq: 6, lastMemberDocId: 'ghost', updatedAt: serverTimestamp(), updatedBy: 'admin' }),
    );
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'counters', path), { year, lastSeq: 6, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('changing the year is denied', async () => {
    await assertFails(counter('admin', { year: year - 1, lastSeq: 6 }));
  });

  it('a spoofed updatedBy / client-clock updatedAt is denied', async () => {
    await assertFails(counter('admin', { year, lastSeq: 6, updatedBy: 'staff' }));
    await assertFails(counter('admin', { year, lastSeq: 6, updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  });

  it('nobody can delete a counter; staff/admin can read it, a member cannot', async () => {
    await assertFails(deleteDoc(doc(dbFor(env, 'admin'), 'counters', path)));
    await assertSucceeds(getDoc(doc(dbFor(env, 'staff'), 'counters', path)));
    await assertFails(getDoc(doc(dbFor(env, 'member1'), 'counters', path)));
  });
});
