import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { attendanceDocId } from '../../src/domain/attendance';
import { addIstDays, istDayKey, todayIstStart } from '../../src/domain/dates';
import { MEM, MEMBER_ID_TEXT } from './fixtures';
import { BROKEN_ROLE_UIDS, createTestEnv, dbFor, seedMember, seedUsers } from './setup';

/**
 * Permission Matrix rows: "Attendance: mark check-in/out/absent" (Admin yes, Staff yes, Member no),
 * "Attendance: edit/delete/backdate" (Admin only for delete; nobody edits or backdates) and "Attendance: today's list /
 * member history" (Admin, Staff, Member own only). The IST day comes from the SERVER time (request.time).
 */
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
  await seedMember(env, { docId: MEM });
  await seedMember(env, { docId: 'mem2', seq: 2, mobile: '9123456780' });
});

const now = () => new Date();
const today = () => todayIstStart();
const idFor = (memberDocId = MEM, at = now()) => attendanceDocId(memberDocId, at);

/** A check-in body exactly as checkInTx writes it. */
function checkIn(uid: string, over: Record<string, unknown> = {}) {
  return {
    memberDocId: MEM, memberId: MEMBER_ID_TEXT, memberName: 'Rahul Sharma',
    date: Timestamp.fromDate(today()), dateKey: istDayKey(now()), status: 'PRESENT',
    checkInAt: serverTimestamp(), checkOutAt: null, checkedOut: false,
    createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid,
    ...over,
  };
}
const put = (uid: string | null, over: Record<string, unknown> = {}, id = idFor()) =>
  setDoc(doc(dbFor(env, uid), 'attendance', id), checkIn(uid ?? 'x', over));

async function seedRecord(over: Record<string, unknown> = {}, id = idFor()) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'attendance', id), {
      ...checkIn('staff'), checkInAt: Timestamp.fromMillis(Date.now() - 60_000), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over,
    });
  });
}

describe('attendance: mark check-in / check-out / absent (matrix: Admin yes, Staff yes, Member no)', () => {
  it('STAFF can check a member in', async () => {
    await assertSucceeds(put('staff'));
  });

  it('ADMIN can check a member in', async () => {
    await assertSucceeds(put('admin'));
  });

  it('a check-out (PRESENT -> checked out, time = server time, after the check-in) is allowed for Staff and Admin', async () => {
    for (const uid of ['staff', 'admin']) {
      await env.clearFirestore();
      await seedUsers(env);
      await seedMember(env, { docId: MEM });
      await seedRecord();
      await assertSucceeds(updateDoc(doc(dbFor(env, uid), 'attendance', idFor()), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: uid }));
    }
  });

  it('an explicit ABSENT mark (no check-in time) is allowed, and a later arrival turns it into PRESENT (still one record)', async () => {
    await assertSucceeds(put('staff', { status: 'ABSENT', checkInAt: null }));
    await assertSucceeds(updateDoc(doc(dbFor(env, 'staff'), 'attendance', idFor()), { status: 'PRESENT', checkInAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'staff' }));
  });

  it('MEMBER (even the linked one), anonymous and every broken-role user cannot create or update', async () => {
    await seedRecord({}, idFor('mem2'));
    for (const uid of ['member1', 'member2', null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(put(uid));
      await assertFails(updateDoc(doc(dbFor(env, uid), 'attendance', idFor('mem2')), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: uid ?? 'x' }));
    }
  });

  it('the document id must be `{memberDocId}_{YYYYMMDD}` of the SERVER day (one record per member per IST day)', async () => {
    await assertFails(put('staff', {}, 'random-id'));
    await assertFails(put('staff', {}, idFor(MEM, addIstDays(now(), -1)))); // yesterday's id with today's body
    await assertFails(put('staff', { dateKey: istDayKey(addIstDays(now(), -1)), date: Timestamp.fromDate(addIstDays(today(), -1)) }, idFor(MEM, addIstDays(now(), -1)))); // BACKDATED whole record
    await assertFails(put('staff', { dateKey: istDayKey(addIstDays(now(), 1)), date: Timestamp.fromDate(addIstDays(today(), 1)) }, idFor(MEM, addIstDays(now(), 1)))); // future
    await assertFails(put('staff', { date: Timestamp.fromDate(addIstDays(today(), -1)) })); // dateKey today, date yesterday
  });

  it('a second create for the same member and day is an update, and an update that re-creates a PRESENT record is refused', async () => {
    await assertSucceeds(put('staff'));
    await assertFails(put('staff')); // already PRESENT: not a legal transition
  });

  it('check-in / check-out times are the SERVER time, never a client clock', async () => {
    await assertFails(put('staff', { checkInAt: Timestamp.fromDate(new Date(Date.now() - 3_600_000)) }));
    await seedRecord();
    await assertFails(updateDoc(doc(dbFor(env, 'staff'), 'attendance', idFor()), { checkOutAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: 'staff' }));
  });

  it('the snapshot must match the live member (memberId, name), createdBy the caller, and no extra fields', async () => {
    await assertFails(put('staff', { memberId: 'GYM-2026-0099' }));
    await assertFails(put('staff', { memberName: 'Someone Else' }));
    await assertFails(put('staff', { createdBy: 'admin' }));
    await assertFails(put('staff', { extra: 1 }));
    await assertFails(put('staff', { status: 'LATE' }));
  });

  it('a SUSPENDED or soft-deleted member cannot be checked in (NEW-12); marking a suspended member ABSENT is allowed', async () => {
    await seedMember(env, { docId: 'sus', seq: 3, mobile: '9123456781', overrides: { suspended: true, hasMembership: true } });
    const susBody = { memberDocId: 'sus', memberId: `GYM-${MEMBER_ID_TEXT.slice(4, 8)}-0003` };
    await assertFails(put('staff', susBody, idFor('sus')));
    await assertSucceeds(put('staff', { ...susBody, status: 'ABSENT', checkInAt: null }, idFor('sus')));
    await seedMember(env, { docId: 'gone', seq: 4, mobile: '9123456782', overrides: { deleted: true } });
    await assertFails(put('admin', { memberDocId: 'gone', memberId: `GYM-${MEMBER_ID_TEXT.slice(4, 8)}-0004` }, idFor('gone')));
  });

  it('a check-out needs the record to be today, PRESENT and open; a second check-out and an ABSENT check-out are refused', async () => {
    await seedRecord({ checkOutAt: Timestamp.now(), checkedOut: true });
    await assertFails(updateDoc(doc(dbFor(env, 'staff'), 'attendance', idFor()), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: 'staff' }));
    await env.clearFirestore();
    await seedUsers(env);
    await seedMember(env, { docId: MEM });
    await seedRecord({ status: 'ABSENT', checkInAt: null });
    await assertFails(updateDoc(doc(dbFor(env, 'staff'), 'attendance', idFor()), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: 'staff' }));
  });

  it('a past day\'s record cannot be edited by anyone (no backdating, no late check-out), not even an Admin', async () => {
    const yesterday = idFor(MEM, addIstDays(now(), -1));
    await seedRecord({ dateKey: istDayKey(addIstDays(now(), -1)), date: Timestamp.fromDate(addIstDays(today(), -1)), checkInAt: Timestamp.fromDate(addIstDays(now(), -1)) }, yesterday);
    for (const uid of ['admin', 'staff']) {
      await assertFails(updateDoc(doc(dbFor(env, uid), 'attendance', yesterday), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: uid }));
    }
  });

  it('identity, snapshot and date fields are frozen on update', async () => {
    await seedRecord();
    for (const fields of [{ memberDocId: 'mem2' }, { memberName: 'X' }, { dateKey: '20200101' }, { date: Timestamp.fromDate(addIstDays(today(), -3)) }, { createdBy: 'admin' }]) {
      await assertFails(updateDoc(doc(dbFor(env, 'staff'), 'attendance', idFor()), { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: 'staff', ...fields }));
    }
  });
});

describe('attendance: edit / delete (matrix: Admin only for delete; no edit or backdate for anyone)', () => {
  it('ADMIN can delete a record; STAFF, MEMBER, anonymous and broken-role users cannot', async () => {
    await seedRecord();
    for (const uid of ['staff', 'member1', null, ...BROKEN_ROLE_UIDS]) await assertFails(deleteDoc(doc(dbFor(env, uid), 'attendance', idFor())));
    await assertSucceeds(deleteDoc(doc(dbFor(env, 'admin'), 'attendance', idFor())));
  });

  it('a free-form edit (e.g. flipping status or rewriting times) is refused for Admin and Staff', async () => {
    await seedRecord();
    for (const uid of ['admin', 'staff']) {
      await assertFails(updateDoc(doc(dbFor(env, uid), 'attendance', idFor()), { status: 'ABSENT', updatedAt: serverTimestamp(), updatedBy: uid }));
      await assertFails(updateDoc(doc(dbFor(env, uid), 'attendance', idFor()), { checkInAt: Timestamp.fromDate(new Date('2020-01-01')), updatedAt: serverTimestamp(), updatedBy: uid }));
    }
  });
});

describe("attendance: today's list and member history (matrix: Admin, Staff, Member own only)", () => {
  beforeEach(async () => {
    await seedRecord();
    await seedRecord({ memberDocId: 'mem2', memberId: `GYM-${MEMBER_ID_TEXT.slice(4, 8)}-0002`, memberName: 'Other Person' }, idFor('mem2'));
  });

  it('ADMIN and STAFF can get and list (including a range / equality query)', async () => {
    for (const uid of ['admin', 'staff']) {
      await assertSucceeds(getDoc(doc(dbFor(env, uid), 'attendance', idFor())));
      await assertSucceeds(getDocs(collection(dbFor(env, uid), 'attendance')));
      await assertSucceeds(getDocs(query(collection(dbFor(env, uid), 'attendance'), where('date', '==', Timestamp.fromDate(today())))));
    }
  });

  it('a MEMBER reads only their own records (get and a query constrained to themselves), never another member\'s or the whole collection', async () => {
    const m = dbFor(env, 'member1'); // linked to mem1
    await assertSucceeds(getDoc(doc(m, 'attendance', idFor(MEM))));
    await assertSucceeds(getDocs(query(collection(m, 'attendance'), where('memberDocId', '==', MEM))));
    await assertFails(getDoc(doc(m, 'attendance', idFor('mem2'))));
    await assertFails(getDocs(query(collection(m, 'attendance'), where('memberDocId', '==', 'mem2'))));
    await assertFails(getDocs(collection(m, 'attendance')));
  });

  it('anonymous and every broken-role user are denied', async () => {
    for (const uid of [null, ...BROKEN_ROLE_UIDS]) {
      await assertFails(getDoc(doc(dbFor(env, uid), 'attendance', idFor())));
      await assertFails(getDocs(collection(dbFor(env, uid), 'attendance')));
    }
  });
});
