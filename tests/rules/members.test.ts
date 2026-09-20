import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { addAudit, createTestEnv, currentYear, dbFor, istMidnight, memberData, memberUpdate, registerBatch, seedMember, seedUsers } from './setup';

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

// A profile edit is one commit: the member update plus its MEMBER_UPDATED audit record (architecture 3.4).
const edit = (db: ReturnType<typeof dbFor>, uid: string, fields: Record<string, unknown>) => memberUpdate(db, uid, 'mem1', fields);

describe('members: register (create) - Permission Matrix rows 3-8', () => {
  it('ADMIN and STAFF can register a member (counter + member in one commit)', async () => {
    await assertSucceeds(registerBatch(dbFor(env, 'admin'), { uid: 'admin' }).commit());
    await assertSucceeds(registerBatch(dbFor(env, 'staff'), { uid: 'staff', docId: 'mem2', seq: 2, mobile: '9123456780' }).commit());
  });

  it('MEMBER, anonymous, role-less and inactive users cannot register', async () => {
    for (const uid of ['member1', null, 'noRole', 'inactive']) {
      await env.clearFirestore();
      await seedUsers(env);
      await assertFails(registerBatch(dbFor(env, uid), { uid: uid ?? 'x' }).commit());
    }
  });

  it('the first registration of a year (no counter doc yet) is allowed; the next one needs lastSeq + 1', async () => {
    const admin = dbFor(env, 'admin');
    await assertSucceeds(registerBatch(admin, { uid: 'admin', seq: 1 }).commit());
    await assertSucceeds(registerBatch(admin, { uid: 'admin', docId: 'mem2', seq: 2, mobile: '9123456780' }).commit());
  });

  it('a member create WITHOUT the counter increment is denied', async () => {
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', omitCounter: true }).commit());
  });

  it('cannot skip a number (counter +2) or reuse one (counter unchanged)', async () => {
    await seedMember(env, { seq: 3, mobile: '9000000001', docId: 'existing' });
    const admin = dbFor(env, 'admin');
    await assertFails(registerBatch(admin, { uid: 'admin', docId: 'mem2', seq: 5, mobile: '9123456780' }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', docId: 'mem2', seq: 3, mobile: '9123456780' }).commit());
    await assertSucceeds(registerBatch(admin, { uid: 'admin', docId: 'mem2', seq: 4, mobile: '9123456780' }).commit());
  });

  it('an ID that REUSES the current counter value is denied even when the counter is not written at all (no duplicate IDs)', async () => {
    await seedMember(env, { seq: 3, mobile: '9000000001', docId: 'existing' }); // counter is at 3, GYM-YYYY-0003 is taken
    await assertFails(
      registerBatch(dbFor(env, 'admin'), { uid: 'admin', docId: 'dup', seq: 3, mobile: '9123456780', omitCounter: true }).commit(),
    );
  });

  it('memberId must be the ID DERIVED from the counter written in the same commit (no forged / mismatched IDs)', async () => {
    const y = currentYear();
    const admin = dbFor(env, 'admin');
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { memberId: `GYM-${y}-0002` } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { memberId: 'GYM-1-1' } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { memberId: `gym-${y}-0001` } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { memberIdYear: y + 5 } }).commit());
  });

  it('IDs past 9999 keep growing (GYM-YYYY-10000)', async () => {
    await seedMember(env, { seq: 9999, mobile: '9000000001', docId: 'existing' });
    await assertSucceeds(
      registerBatch(dbFor(env, 'admin'), { uid: 'admin', docId: 'big', seq: 10000, mobile: '9123456780' }).commit(),
    );
  });

  it.each([
    ['deleted: true', { deleted: true }],
    ['pendingPaise: 5', { pendingPaise: 5 }],
    ['hasMembership: true', { hasMembership: true }],
    ['suspended: true', { suspended: true }],
    ['a pre-filled membership summary', { membership: { membershipId: 'm', planId: null, planName: null, startDate: null, endDate: null, amountPaise: null } }],
    ['an unknown extra field', { role: 'ADMIN' }],
    ['consent.given false', { consent: { given: false, at: serverTimestamp(), byUid: 'admin', byName: 'T', version: 'v', guardianConsent: false } }],
    ['a forged consent.byUid', { consent: { given: true, at: serverTimestamp(), byUid: 'someoneElse', byName: 'T', version: 'v', guardianConsent: false } }],
    ['a client-clock consent.at', { consent: { given: true, at: Timestamp.fromDate(new Date('2020-01-01')), byUid: 'admin', byName: 'T', version: 'v', guardianConsent: false } }],
    ['guardianConsent without a guardian', { consent: { given: true, at: serverTimestamp(), byUid: 'admin', byName: 'T', version: 'v', guardianConsent: true } }],
    ['a client-clock createdAt', { createdAt: Timestamp.fromDate(new Date('2020-01-01')) }],
    ['a spoofed createdBy', { createdBy: 'staff' }],
    ['an invalid mobile', { mobile: '12345', searchMobile: '12345' }],
    ['searchMobile that differs from mobile', { searchMobile: '9000000009' }],
    ['a date of birth that is not IST midnight', { dateOfBirth: Timestamp.fromMillis(Date.UTC(1995, 4, 10)) }],
    ['a future date of birth', { dateOfBirth: istMidnight(2999, 1, 1) }],
    ['a future joining date', { joiningDate: istMidnight(2999, 1, 1) }],
    ['an unknown gender', { gender: 'ROBOT' }],
    ['an empty first name', { firstName: '' }],
    ['a 51-character last name', { lastName: 'x'.repeat(51) }],
    ['a malformed emergencyContact', { emergencyContact: { name: 'A', mobile: '1' } }],
    ['notes over 1000 characters', { generalNotes: 'x'.repeat(1001) }],
  ])('create with %s is denied', async (_label, overrides) => {
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', overrides }).commit());
  });

  it('a guardian-consent registration WITH a guardian is allowed', async () => {
    await assertSucceeds(
      registerBatch(dbFor(env, 'admin'), {
        uid: 'admin',
        overrides: {
          emergencyContact: { name: 'Parent', mobile: '9123456789' },
          consent: { given: true, at: serverTimestamp(), byUid: 'admin', byName: 'T', version: 'consent-v1', guardianConsent: true },
        },
      }).commit(),
    );
  });
});

describe('members: duplicate mobile is a WARNING, not a database constraint (NEW-14)', () => {
  it('a second member may share a mobile (families share phones); the app warns and asks for confirmation', async () => {
    await seedMember(env, { mobile: '9876543210' });
    await assertSucceeds(
      registerBatch(dbFor(env, 'admin'), { uid: 'admin', docId: 'mem2', seq: 2, mobile: '9876543210' }).commit(),
    );
  });

  it('the collection that used to hold the mobile locks is gone: it is denied like any unlisted path', async () => {
    await assertFails(setDoc(doc(dbFor(env, 'admin'), 'memberMobiles', '9876543210'), { memberDocId: 'x' }));
    await assertFails(getDoc(doc(dbFor(env, 'admin'), 'memberMobiles', '9876543210')));
  });
});

describe('members: one counter increment = exactly one new member (A3)', () => {
  it('a counter that names a DIFFERENT member than the one created is denied', async () => {
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', counterNames: 'someoneElse' }).commit());
  });

  it('two members cannot share one counter increment', async () => {
    const admin = dbFor(env, 'admin');
    const batch = registerBatch(admin, { uid: 'admin', docId: 'mem1', seq: 1 });
    batch.set(doc(admin, 'members', 'mem2'), memberData({ uid: 'admin', seq: 1, mobile: '9123456780', overrides: { lastAuditId: 'audit2' } }));
    addAudit(batch, admin, 'admin', 'audit2', 'MEMBER_CREATED', 'member', 'mem2'); // complete in every other way: only the counter rule can refuse it
    await assertFails(batch.commit());
  });

  it('a counter cannot be advanced for a member that already exists (no member created in the commit)', async () => {
    await seedMember(env, { seq: 1, docId: 'mem1' });
    await assertFails(
      setDoc(doc(dbFor(env, 'admin'), 'counters', `memberId-${currentYear()}`), {
        year: currentYear(), lastSeq: 2, lastMemberDocId: 'mem1', updatedAt: serverTimestamp(), updatedBy: 'admin',
      }),
    );
  });

  it('search fields must be consistent with the name and mobile', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { searchFullName: 'someone else' } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { searchReverseName: 'rahul sharma' } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { displayName: 'Other Name' } }).commit());
    await assertFails(registerBatch(admin, { uid: 'admin', overrides: { searchFullName: 'Rahul Sharma' } }).commit()); // not lower-case
  });

  it('non-ASCII names are accepted with lower-case search fields (NFKD cannot be reproduced in rules)', async () => {
    await assertSucceeds(
      registerBatch(dbFor(env, 'admin'), {
        uid: 'admin',
        overrides: { firstName: 'Zoë', lastName: 'Ünal', displayName: 'Zoë Ünal', searchFullName: 'zoe\u0308 u\u0308nal', searchReverseName: 'u\u0308nal zoe\u0308' },
      }).commit(),
    );
  });
});

describe('members: read', () => {
  beforeEach(async () => {
    await seedMember(env, { docId: 'mem1' });
    await seedMember(env, { docId: 'mem2', seq: 2, mobile: '9123456780' });
  });

  it('ADMIN and STAFF can get and list', async () => {
    for (const uid of ['admin', 'staff']) {
      await assertSucceeds(getDoc(doc(dbFor(env, uid), 'members', 'mem1')));
      // every app query is constrained to live members, which is what lets Staff list at all
      await assertSucceeds(getDocs(query(collection(dbFor(env, uid), 'members'), where('deleted', '==', false))));
    }
  });

  it('STAFF cannot read or list a soft-deleted member; ADMIN can (D-8)', async () => {
    await seedMember(env, { docId: 'gone', seq: 3, mobile: '9123456781', overrides: { deleted: true } });
    await assertFails(getDoc(doc(dbFor(env, 'staff'), 'members', 'gone')));
    await assertSucceeds(getDoc(doc(dbFor(env, 'admin'), 'members', 'gone')));
    await assertFails(getDocs(collection(dbFor(env, 'staff'), 'members'))); // unconstrained list cannot be proven safe
    await assertSucceeds(getDocs(query(collection(dbFor(env, 'staff'), 'members'), where('deleted', '==', false))));
    await assertSucceeds(getDocs(query(collection(dbFor(env, 'admin'), 'members'), where('searchMobile', '==', '9123456781'))));
  });

  it('a MEMBER reads only their own linked member doc, never another and never a list', async () => {
    const m = dbFor(env, 'member1'); // linked to mem1
    await assertSucceeds(getDoc(doc(m, 'members', 'mem1')));
    await assertFails(getDoc(doc(m, 'members', 'mem2')));
    await assertFails(getDocs(collection(m, 'members')));
  });

  it('anonymous, role-less and inactive users cannot read', async () => {
    for (const uid of [null, 'noRole', 'inactive']) {
      await assertFails(getDoc(doc(dbFor(env, uid), 'members', 'mem1')));
    }
  });
});

describe('members: edit (update)', () => {
  beforeEach(async () => {
    await seedMember(env);
  });

  it('ADMIN can edit profile fields', async () => {
    await assertSucceeds(
      edit(dbFor(env, 'admin'), 'admin', {
        address: '12 MG Road', firstName: 'Rahil', displayName: 'Rahil Sharma', searchFullName: 'rahil sharma', searchReverseName: 'sharma rahil',
      }),
    );
  });

  it('STAFF and MEMBER cannot edit (matrix: edit member = Admin only)', async () => {
    await assertFails(edit(dbFor(env, 'staff'), 'staff', { address: 'x' }));
    await assertFails(edit(dbFor(env, 'member1'), 'member1', { address: 'x' }));
    await assertFails(edit(dbFor(env, null), 'x', { address: 'x' }));
  });

  it('memberId, memberIdYear, createdAt, createdBy are immutable', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(edit(admin, 'admin', { memberId: `GYM-${currentYear()}-0099` }));
    await assertFails(edit(admin, 'admin', { memberIdYear: currentYear() - 1 }));
    await assertFails(edit(admin, 'admin', { createdAt: Timestamp.fromDate(new Date('2020-01-01')) }));
    await assertFails(edit(admin, 'admin', { createdBy: 'staff' }));
  });

  it('consent, pendingPaise, suspension and the membership summary cannot be changed by a profile edit', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(edit(admin, 'admin', { pendingPaise: 100 }));
    await assertFails(edit(admin, 'admin', { suspended: true }));
    await assertFails(edit(admin, 'admin', { hasMembership: true }));
    await assertFails(edit(admin, 'admin', { 'membership.endDate': Timestamp.now() }));
    await assertFails(edit(admin, 'admin', { 'consent.given': false }));
  });

  it('a name change without matching search fields is denied; every update must write a NEW lastAuditId (A3)', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(edit(admin, 'admin', { firstName: 'Rahil', displayName: 'Rahil Sharma' }));
    await assertFails(updateDoc(doc(admin, 'members', 'mem1'), { address: 'x', updatedAt: serverTimestamp(), updatedBy: 'admin' })); // no lastAuditId change
    await assertFails(edit(admin, 'admin', { address: 'x', lastAuditId: 'audit1' })); // unchanged id (its audit record is written, so only the id rule can refuse it)
  });

  it('updatedAt must be the server time and updatedBy the caller', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(edit(admin, 'admin', { address: 'x', updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
    await assertFails(edit(admin, 'admin', { address: 'x', updatedBy: 'staff' }));
  });

  it('an invalid value is denied (bad mobile, future joining date, oversize notes)', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(edit(admin, 'admin', { mobile: '123', searchMobile: '123' }));
    await assertFails(edit(admin, 'admin', { mobile: '9000000009' })); // searchMobile not kept in step
    await assertFails(edit(admin, 'admin', { joiningDate: istMidnight(2999, 1, 1) }));
    await assertFails(edit(admin, 'admin', { generalNotes: 'x'.repeat(1001) }));
  });

  it('the hasPhoto flag can be raised by an Admin edit', async () => {
    await assertSucceeds(edit(dbFor(env, 'admin'), 'admin', { hasPhoto: true }));
  });
});

describe('members: soft delete only (NEW-16, D-8)', () => {
  beforeEach(async () => {
    await seedMember(env);
  });

  const softDelete = (uid: string, extra: Record<string, unknown> = {}) =>
    memberUpdate(
      dbFor(env, uid),
      uid,
      'mem1',
      { deleted: true, deletedAt: serverTimestamp(), deletedBy: uid, lastAuditId: 'a3', ...extra },
      { action: 'MEMBER_DELETED' },
    );

  it('ADMIN can soft-delete', async () => {
    await assertSucceeds(softDelete('admin'));
  });

  it('STAFF cannot soft-delete', async () => {
    await assertFails(softDelete('staff'));
  });

  it('a soft delete cannot smuggle other changes (e.g. clearing consent or zeroing dues)', async () => {
    await assertFails(softDelete('admin', { pendingPaise: 0, firstName: 'Changed' }));
    await assertFails(softDelete('admin', { deletedBy: 'staff' }));
  });

  it('a deleted member cannot be edited or restored', async () => {
    await assertSucceeds(softDelete('admin'));
    await assertFails(edit(dbFor(env, 'admin'), 'admin', { address: 'x' }));
    await assertFails(edit(dbFor(env, 'admin'), 'admin', { deleted: false }));
  });

  it('a HARD delete is denied for everyone, including ADMIN', async () => {
    for (const uid of ['admin', 'staff', 'member1']) {
      await assertFails(deleteDoc(doc(dbFor(env, uid), 'members', 'mem1')));
    }
  });
});

describe("members: nothing else is reachable", () => {
  it('members cannot be written through a collection-group or a subpath', async () => {
    const admin = dbFor(env, 'admin');
    await assertFails(setDoc(doc(admin, 'members', 'mem1', 'sub', 'x'), { a: 1 }));
    // even a rule-valid member doc is refused when NO counter increment accompanies it
    await assertFails(writeBatch(admin).set(doc(admin, 'members', 'mem9'), memberData({ uid: 'admin' })).commit());
  });
});
