import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
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
  await seedMember(env, { docId: 'mem2', seq: 2, mobile: '9123456780' });
});

const photo = (uid: string, over: Record<string, unknown> = {}) => ({
  dataUrl: 'data:image/webp;base64,QUJDREVGRw==',
  contentType: 'image/webp',
  bytes: 7,
  width: 64,
  height: 64,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...over,
});
const put = (uid: string, over: Record<string, unknown> = {}, id = 'mem1') =>
  setDoc(doc(dbFor(env, uid), 'memberPhotos', id), photo(uid, over));

async function seedPhoto() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'memberPhotos', 'mem1'), { ...photo('admin'), updatedAt: new Date() });
  });
}

describe('memberPhotos create/update (US-2.5)', () => {
  it('STAFF and ADMIN can add a first photo', async () => {
    await assertSucceeds(put('staff'));
    await assertSucceeds(put('admin', {}, 'mem2'));
  });

  it('STAFF cannot REPLACE an existing photo; ADMIN can', async () => {
    await seedPhoto();
    await assertFails(put('staff'));
    await assertSucceeds(put('admin'));
  });

  it('a photo for a member that does not exist, or that is soft-deleted, is denied (A3)', async () => {
    await assertFails(put('admin', {}, 'ghost'));
    await seedMember(env, { docId: 'gone', seq: 3, mobile: '9123456781', overrides: { deleted: true } });
    await assertFails(put('staff', {}, 'gone'));
    await assertFails(put('admin', {}, 'gone'));
  });

  it.each([
    ['over 100 KB (bytes)', { bytes: 102401 }],
    ['zero bytes', { bytes: 0 }],
    ['a dataUrl over 180,000 characters', { dataUrl: 'data:image/webp;base64,' + 'A'.repeat(180_000) }],
    ['a PNG content type', { contentType: 'image/png', dataUrl: 'data:image/png;base64,QUJD' }],
    ['a dataUrl whose prefix disagrees with contentType', { dataUrl: 'data:image/jpeg;base64,QUJD' }],
    ['a non-image dataUrl', { dataUrl: 'data:text/html;base64,QUJD' }],
    ['a dataUrl with an injected payload', { dataUrl: 'data:image/webp;base64,QUJD"><script>' }],
    ['an oversized dimension', { width: 4000 }],
    ['an extra field', { note: 'x' }],
    ['a spoofed updatedBy', { updatedBy: 'someoneElse' }],
  ])('%s is denied', async (_label, over) => {
    await assertFails(put('admin', over));
  });

  it('a photo of exactly 100 KB (102,400 bytes) is allowed', async () => {
    await assertSucceeds(put('admin', { bytes: 102400 }));
  });
});

describe('memberPhotos read/delete', () => {
  beforeEach(async () => {
    await seedPhoto();
  });

  it('STAFF and ADMIN can read', async () => {
    await assertSucceeds(getDoc(doc(dbFor(env, 'staff'), 'memberPhotos', 'mem1')));
    await assertSucceeds(getDoc(doc(dbFor(env, 'admin'), 'memberPhotos', 'mem1')));
  });

  it('a MEMBER reads only their own photo', async () => {
    await assertSucceeds(getDoc(doc(dbFor(env, 'member1'), 'memberPhotos', 'mem1')));
    await assertFails(getDoc(doc(dbFor(env, 'member2'), 'memberPhotos', 'mem1')));
    await assertFails(getDoc(doc(dbFor(env, 'member1'), 'memberPhotos', 'mem2')));
  });

  it('anonymous, role-less and inactive users cannot read', async () => {
    for (const uid of [null, 'noRole', 'inactive']) await assertFails(getDoc(doc(dbFor(env, uid), 'memberPhotos', 'mem1')));
  });

  it('only ADMIN can delete', async () => {
    await assertFails(deleteDoc(doc(dbFor(env, 'staff'), 'memberPhotos', 'mem1')));
    await assertSucceeds(deleteDoc(doc(dbFor(env, 'admin'), 'memberPhotos', 'mem1')));
  });
});
