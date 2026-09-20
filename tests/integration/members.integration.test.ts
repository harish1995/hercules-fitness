import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fromCivilDate } from '../../src/domain/dates';
import { AppError, DuplicateMobileError } from '../../src/services/errors';
import {
  countMembers,
  getMemberById,
  listMembersPage,
  newMembersByMonth,
} from '../../src/services/memberQueries';
import {
  findMemberByMobileTx,
  findMembersByMobileTx,
  newMemberDocId,
  registerMemberTx,
  softDeleteMemberTx,
  updateMemberTx,
} from '../../src/services/memberTransactions';
import { type Actor, type Member, type MemberListQuery, type MemberListStatus, type MemberProfileInput, type Page } from '../../src/types/member';
import { createTestEnv, currentYear, dbFor, padSeq, seedUsers } from './../rules/setup';

/**
 * Runs the REAL service transactions and queries against the Firestore emulator with the REAL rules, so the
 * client/rules contract is proven end to end (member-ID concurrency, duplicate-mobile warning, rollback, audit atomicity).
 */
let env: RulesTestEnvironment;
let admin: Firestore;
let staff: Firestore;
const adminActor: Actor = { uid: 'admin', name: 'Owner', role: 'ADMIN' };
const staffActor: Actor = { uid: 'staff', name: 'Front Desk', role: 'STAFF' };

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
  admin = dbFor(env, 'admin');
  staff = dbFor(env, 'staff');
});

function profile(over: Partial<MemberProfileInput> = {}): MemberProfileInput {
  return {
    firstName: 'Rahul',
    lastName: 'Sharma',
    gender: 'MALE',
    dateOfBirth: fromCivilDate(1995, 5, 10),
    mobile: '9876543210',
    email: null,
    address: null,
    emergencyContact: null,
    trainerId: null,
    joiningDate: fromCivilDate(2026, 1, 15),
    generalNotes: null,
    ...over,
  };
}

// Most tests are not about the duplicate-mobile warning, so they confirm it (NEW-14); the dedicated describe below does not.
const register = (
  db: Firestore,
  actor: Actor,
  over: Partial<MemberProfileInput> = {},
  medicalNotes: string | null = null,
  duplicateMobileConfirmed = true,
) =>
  registerMemberTx({
    db,
    memberDocId: newMemberDocId(db),
    actor,
    duplicateMobileConfirmed,
    input: { profile: profile(over), medicalNotes, consentGiven: true, guardianConsent: false },
  });

const browseQuery = (status: MemberListStatus): MemberListQuery => ({
  mode: 'browse', status, planId: null, expiryFrom: null, expiryTo: null, sort: 'REGISTERED', today: fromCivilDate(2026, 9, 19),
});

/** updateMemberTx with the mobile the form loaded with (defaults to the profile() mobile). */
const updateOf = (
  db: Firestore,
  actor: Actor,
  m: { memberDocId: string },
  member: Member,
  input: Parameters<typeof updateMemberTx>[0]['input'],
  extra: { duplicateMobileConfirmed?: boolean } = {},
) => updateMemberTx({ db, memberDocId: m.memberDocId, expectedVersion: member.version, currentMobile: member.mobile, actor, input, ...extra });

async function raw(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, path));
    data = snap.exists() ? snap.data() : undefined;
  });
  return data;
}
async function rawCollection(name: string) {
  const out: { id: string; data: Record<string, unknown> }[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore() as unknown as Firestore, name));
    snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
  });
  return out;
}

describe('TX-1 registerMember: member ID counter (US-2.2, AC-7)', () => {
  it('allocates GYM-YYYY-NNNN sequentially and writes counter, member and audit together', async () => {
    const y = currentYear();
    const a = await register(admin, adminActor);
    const b = await register(staff, staffActor, { mobile: '9123456780', firstName: 'Sita' });
    expect(a.memberId).toBe(`GYM-${y}-0001`);
    expect(b.memberId).toBe(`GYM-${y}-0002`);
    expect(await raw(`counters/memberId-${y}`)).toMatchObject({ lastSeq: 2, lastMemberDocId: b.memberDocId }); // names its one new member
    const member = await raw(`members/${a.memberDocId}`);
    expect(member).toMatchObject({ memberId: a.memberId, deleted: false, suspended: false, pendingPaise: 0, hasMembership: false });
    expect(member?.consent).toMatchObject({ given: true, byUid: 'admin', version: 'consent-v1', guardianConsent: false });
    const audits = await rawCollection('auditLogs');
    expect(audits).toHaveLength(2);
    expect(audits.find((x) => x.data.entityId === a.memberDocId)?.data).toMatchObject({
      action: 'MEMBER_CREATED', entity: 'member', actorUid: 'admin', actorRole: 'ADMIN',
    });
  });

  it('8 simultaneous registrations (admin and staff) get 8 distinct, sequential IDs with no gaps', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        register(i % 2 === 0 ? admin : staff, i % 2 === 0 ? adminActor : staffActor, { mobile: `98765432${10 + i}`, firstName: `P${i}` }),
      ),
    );
    const ids = results.map((r) => r.memberId).sort();
    expect(new Set(ids).size).toBe(8);
    expect(ids).toEqual(Array.from({ length: 8 }, (_, i) => `GYM-${currentYear()}-${padSeq(i + 1)}`));
    expect((await raw(`counters/memberId-${currentYear()}`))?.lastSeq).toBe(8);
    expect(await rawCollection('members')).toHaveLength(8);
    expect(await rawCollection('auditLogs')).toHaveLength(8);
  }, 60_000);

  it('a failed registration rolls back completely: no ID consumed, no member, no audit (US-2.2b)', async () => {
    await expect(register(admin, adminActor, { trainerId: 'ghost-trainer' })).rejects.toBeInstanceOf(AppError);
    expect(await rawCollection('members')).toHaveLength(0);
    expect(await rawCollection('counters')).toHaveLength(0);
    expect(await rawCollection('auditLogs')).toHaveLength(0);
    const next = await register(admin, adminActor);
    expect(next.memberId).toBe(`GYM-${currentYear()}-0001`); // no gap
  });

  it('is idempotent per document id: a retried submit returns the same member and writes nothing new (US-2.1d)', async () => {
    const memberDocId = newMemberDocId(admin);
    const params = { db: admin, memberDocId, actor: adminActor, input: { profile: profile(), medicalNotes: null, consentGiven: true, guardianConsent: false } };
    const first = await registerMemberTx(params);
    const again = await registerMemberTx(params);
    expect(again).toMatchObject({ memberId: first.memberId, alreadyExisted: true });
    expect((await raw(`counters/memberId-${currentYear()}`))?.lastSeq).toBe(1);
    expect(await rawCollection('auditLogs')).toHaveLength(1);
  });

  it('uses the IST year at the boundary, not the device/UTC year (US-2.2c)', async () => {
    const before = await registerMemberTx({
      db: admin, memberDocId: newMemberDocId(admin), actor: adminActor, clock: () => new Date('2026-12-31T18:29:59.999Z'),
      input: { profile: profile(), medicalNotes: null, consentGiven: true, guardianConsent: false },
    });
    const after = await registerMemberTx({
      db: admin, memberDocId: newMemberDocId(admin), actor: adminActor, clock: () => new Date('2026-12-31T18:30:00.000Z'),
      input: { profile: profile({ mobile: '9123456780' }), medicalNotes: null, consentGiven: true, guardianConsent: false },
    });
    expect(before.memberId).toBe('GYM-2026-0001');
    expect(after.memberId).toBe('GYM-2027-0001'); // new year, new counter, starts at 1
  });

  it('refuses to register without consent (US-2.7b)', async () => {
    await expect(
      registerMemberTx({ db: admin, memberDocId: newMemberDocId(admin), actor: adminActor, input: { profile: profile(), medicalNotes: null, consentGiven: false, guardianConsent: false } }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('duplicate mobile is a WARNING that needs an explicit confirmation (NEW-14)', () => {
  it('a second registration with an equivalent mobile is refused until confirmed, naming the existing member', async () => {
    const first = await register(admin, adminActor);
    const dup = await register(staff, staffActor, { firstName: 'Other' }, null, false).catch((e: unknown) => e);
    expect(dup).toBeInstanceOf(DuplicateMobileError);
    expect((dup as DuplicateMobileError).existing).toEqual({ memberDocId: first.memberDocId, memberId: first.memberId, displayName: 'Rahul Sharma', deleted: false });
    expect(await rawCollection('members')).toHaveLength(1);
    expect((await raw(`counters/memberId-${currentYear()}`))?.lastSeq).toBe(1); // no ID consumed by the warning
    // "register anyway": the same call with the confirmation goes through (families share phones)
    const confirmed = await register(staff, staffActor, { firstName: 'Other' }, null, true);
    expect(confirmed.memberId).toBe(`GYM-${currentYear()}-0002`);
    expect(await rawCollection('members')).toHaveLength(2);
  });

  it('two registrations of the SAME new mobile at once are best effort (US-2.3d): each either succeeds or gets the warning, never another error', async () => {
    const results = await Promise.allSettled([
      register(admin, adminActor, {}, null, false),
      register(staff, staffActor, { firstName: 'Twin' }, null, false),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(DuplicateMobileError);
  }, 30_000);

  it('a retried submit of the SAME registration is not its own duplicate (idempotent)', async () => {
    const memberDocId = newMemberDocId(admin);
    const params = { db: admin, memberDocId, actor: adminActor, input: { profile: profile(), medicalNotes: null, consentGiven: true, guardianConsent: false } };
    const first = await registerMemberTx(params);
    expect(await registerMemberTx(params)).toMatchObject({ memberId: first.memberId, alreadyExisted: true });
  });

  it('the lookup names a live owner; Admin also sees a soft-deleted owner AS deleted, Staff cannot see deleted members; a deleted owner never gates', async () => {
    const m = await register(admin, adminActor);
    expect(await findMemberByMobileTx(staff, '9876543210', 'STAFF')).toMatchObject({ memberDocId: m.memberDocId, memberId: m.memberId, deleted: false });
    expect(await findMemberByMobileTx(staff, '9000000000', 'STAFF')).toBeNull();
    await softDeleteMemberTx({ db: admin, memberDocId: m.memberDocId, actor: adminActor });
    expect(await findMemberByMobileTx(admin, '9876543210', 'ADMIN')).toMatchObject({ memberDocId: m.memberDocId, deleted: true });
    expect(await findMemberByMobileTx(staff, '9876543210', 'STAFF')).toBeNull();
    // a deleted owner is named but allows registration without any confirmation (US-2.3c)
    const again = await register(admin, adminActor, { firstName: 'Reborn' }, null, false);
    expect(again.memberId).toBe(`GYM-${currentYear()}-0002`);
  });

  it('live owners are listed before deleted ones', async () => {
    const gone = await register(admin, adminActor);
    await softDeleteMemberTx({ db: admin, memberDocId: gone.memberDocId, actor: adminActor });
    const live = await register(admin, adminActor, { firstName: 'Live' });
    const owners = await findMembersByMobileTx(admin, '9876543210', 'ADMIN');
    expect(owners.map((o) => [o.memberDocId, o.deleted])).toEqual([[live.memberDocId, false], [gone.memberDocId, true]]);
  });
});

describe('medical notes (US-2.6)', () => {
  it('ADMIN registration stores notes in memberMedical only; the audit record carries no content', async () => {
    const m = await register(admin, adminActor, {}, 'Asthma - inhaler in bag');
    expect((await raw(`memberMedical/${m.memberDocId}`))?.notes).toBe('Asthma - inhaler in bag');
    expect(JSON.stringify(await raw(`members/${m.memberDocId}`))).not.toContain('Asthma');
    expect(JSON.stringify(await rawCollection('auditLogs'))).not.toContain('Asthma');
  });

  it('STAFF cannot register with medical notes (nothing is created)', async () => {
    await expect(register(staff, staffActor, {}, 'secret')).rejects.toBeInstanceOf(AppError);
    expect(await rawCollection('members')).toHaveLength(0);
  });
});

describe('TX-8 updateMember (US-2.10)', () => {
  async function created() {
    const m = await register(admin, adminActor, {}, 'old note');
    const member = (await getMemberById(admin, m.memberDocId)) as Member;
    return { m, member };
  }

  it('updates, bumps the version and audits changed field NAMES only', async () => {
    const { m, member } = await created();
    const res = await updateOf(admin, adminActor, m, member, { profile: profile({ address: '12 Secret Street', firstName: 'Rahil' }), medicalNotes: 'new note' });
    expect(res).toEqual({ changed: true, changedFields: ['firstName', 'address', 'medicalNotes'] });
    const after = (await getMemberById(admin, m.memberDocId)) as Member;
    expect(after.version).not.toBe(member.version);
    expect(after).toMatchObject({ firstName: 'Rahil', displayName: 'Rahil Sharma', address: '12 Secret Street' });
    expect((await raw(`members/${m.memberDocId}`))?.searchFullName).toBe('rahil sharma');
    expect((await raw(`memberMedical/${m.memberDocId}`))?.notes).toBe('new note');
    const audits = (await rawCollection('auditLogs')).filter((a) => a.data.action === 'MEMBER_UPDATED');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.data.metadata).toEqual({ changedFields: 'firstName,address,medicalNotes' });
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain('Secret Street');
    expect(dump).not.toContain('new note');
  });

  it('a save with no changes writes nothing (no audit, no version bump)', async () => {
    const { m, member } = await created();
    const res = await updateOf(admin, adminActor, m, member, { profile: profile(), medicalNotes: 'old note' });
    expect(res).toEqual({ changed: false });
    expect(((await getMemberById(admin, m.memberDocId)) as Member).version).toBe(member.version);
    expect((await rawCollection('auditLogs')).filter((a) => a.data.action === 'MEMBER_UPDATED')).toHaveLength(0);
  });

  it('two admins editing the same record: the second save is refused with CONFLICT, the first is kept (US-2.10d)', async () => {
    const { m, member } = await created();
    const edit = (address: string) => updateOf(admin, adminActor, m, member, { profile: profile({ address }) });
    await edit('first');
    const second = await edit('second').catch((e: unknown) => e);
    expect(second).toBeInstanceOf(AppError);
    expect((second as AppError).kind).toBe('CONFLICT');
    expect(((await getMemberById(admin, m.memberDocId)) as Member).address).toBe('first');
  });

  it('changing the mobile to one another member has needs the same confirmation; an unchanged shared number never warns', async () => {
    const { m, member } = await created();
    const other = await register(admin, adminActor, { mobile: '9123456780', firstName: 'Sita' });
    const clash = await updateOf(admin, adminActor, m, member, { profile: profile({ mobile: '9123456780' }) }).catch((e: unknown) => e);
    expect(clash).toBeInstanceOf(DuplicateMobileError);
    expect((clash as DuplicateMobileError).existing?.memberDocId).toBe(other.memberDocId);
    expect(((await getMemberById(admin, m.memberDocId)) as Member).mobile).toBe('9876543210'); // nothing changed
    // "save anyway"
    await updateOf(admin, adminActor, m, member, { profile: profile({ mobile: '9123456780' }) }, { duplicateMobileConfirmed: true });
    const moved = (await getMemberById(admin, m.memberDocId)) as Member;
    expect(moved.mobile).toBe('9123456780');
    expect((await raw(`members/${m.memberDocId}`))?.searchMobile).toBe('9123456780'); // kept in step (rules require it)
    // now both share the number: editing something ELSE on the (unchanged) shared number does not warn
    await updateOf(admin, adminActor, m, moved, { profile: profile({ mobile: '9123456780', address: 'New street' }) });
    expect(((await getMemberById(admin, m.memberDocId)) as Member).address).toBe('New street');
  });

  it('STAFF cannot edit (rules) and cannot touch medical notes (service)', async () => {
    const { m, member } = await created();
    await expect(updateOf(staff, staffActor, m, member, { profile: profile({ address: 'x' }) })).rejects.toBeInstanceOf(AppError);
    await expect(updateOf(staff, staffActor, m, member, { profile: profile(), medicalNotes: 'x' })).rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
    expect(((await getMemberById(admin, m.memberDocId)) as Member).address).toBeNull();
  });

  it('clearing the medical notes deletes the medical doc (recorded as a name only)', async () => {
    const { m, member } = await created();
    await updateOf(admin, adminActor, m, member, { profile: profile(), medicalNotes: '' });
    expect(await raw(`memberMedical/${m.memberDocId}`)).toBeUndefined();
  });
});

describe('TX-7 softDeleteMember (US-2.11)', () => {
  it('flags the member deleted, audits it, hides it from get/list/count; the document is retained', async () => {
    const m = await register(admin, adminActor);
    await register(admin, adminActor, { mobile: '9123456780', firstName: 'Stay' });
    await softDeleteMemberTx({ db: admin, memberDocId: m.memberDocId, actor: adminActor });
    expect(await getMemberById(admin, m.memberDocId)).toBeNull();
    expect(await countMembers(admin)).toBe(1);
    expect((await listMembersPage(admin, browseQuery('ALL'))).items.map((x) => x.firstName)).toEqual(['Stay']);
    expect(await raw(`members/${m.memberDocId}`)).toMatchObject({ deleted: true, deletedBy: 'admin' });
    expect((await rawCollection('auditLogs')).filter((a) => a.data.action === 'MEMBER_DELETED')).toHaveLength(1);
  });

  it('deleting twice, or as STAFF, fails', async () => {
    const m = await register(admin, adminActor);
    await expect(softDeleteMemberTx({ db: staff, memberDocId: m.memberDocId, actor: staffActor })).rejects.toBeInstanceOf(AppError);
    await softDeleteMemberTx({ db: admin, memberDocId: m.memberDocId, actor: adminActor });
    await expect(softDeleteMemberTx({ db: admin, memberDocId: m.memberDocId, actor: adminActor })).rejects.toMatchObject({ kind: 'NOT_FOUND' });
  });
});

describe('members list: cursor pagination and prefix search (US-2.8)', () => {
  async function seedMany(names: [string, string][]) {
    let i = 0;
    for (const [first, last] of names) {
      await register(admin, adminActor, { firstName: first, lastName: last, mobile: `9${String(100000000 + i++)}` });
    }
  }

  async function collectAll(query: Parameters<typeof listMembersPage>[1], pageSize: number) {
    const rows: Member[] = [];
    const sizes: number[] = [];
    let cursor: Page<Member>['next'] = null;
    for (let guard = 0; guard < 100; guard++) {
      const page: Page<Member> = await listMembersPage(admin, query, cursor, pageSize);
      rows.push(...page.items);
      sizes.push(page.items.length);
      if (!page.next) break;
      cursor = page.next;
    }
    return { rows, sizes };
  }

  it('browse: 25 per page, newest first, next until the last page, no duplicates or omissions', async () => {
    await seedMany(Array.from({ length: 55 }, (_, i) => [`First${i}`, `Last${i}`] as [string, string]));
    const { rows, sizes } = await collectAll(browseQuery('ALL'), 25);
    expect(sizes).toEqual([25, 25, 5]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(55);
    expect(rows[0]?.firstName).toBe('First54'); // newest registered first (NEW-25)
    expect(rows[54]?.firstName).toBe('First0');
  }, 120_000);

  it('an exact multiple of the page size does not produce an empty trailing page', async () => {
    await seedMany(Array.from({ length: 4 }, (_, i) => [`F${i}`, 'L'] as [string, string]));
    expect((await collectAll(browseQuery('ALL'), 2)).sizes).toEqual([2, 2]);
  });

  it('name search is prefix-only and case-insensitive; full-name matches first, then last-name matches, each once', async () => {
    await seedMany([['Sam', 'Verma'], ['Ravi', 'Samuel'], ['Sam', 'Sampat'], ['Samira', 'Khan'], ['Sammy', 'Roy'], ['Rahul', 'Sharma'], ['Ahul', 'Nobody']]);
    for (const term of ['sam', 'SAM'.toLowerCase()]) {
      const { rows, sizes } = await collectAll({ mode: 'search', kind: 'name', term }, 2);
      expect(rows.map((r) => r.displayName)).toEqual(['Sam Sampat', 'Sam Verma', 'Samira Khan', 'Sammy Roy', 'Ravi Samuel']);
      expect(sizes).toEqual([2, 2, 1]);
    }
    expect((await collectAll({ mode: 'search', kind: 'name', term: 'ahul' }, 25)).rows.map((r) => r.displayName)).toEqual(['Ahul Nobody']); // not "Rahul"
    expect((await collectAll({ mode: 'search', kind: 'name', term: 'rahul sh' }, 25)).rows.map((r) => r.displayName)).toEqual(['Rahul Sharma']);
    expect((await collectAll({ mode: 'search', kind: 'name', term: 'sha' }, 25)).rows.map((r) => r.displayName)).toEqual(['Rahul Sharma']); // via the reverse-name key
  }, 60_000);

  it('mobile and member-ID prefix search; soft-deleted members never appear', async () => {
    await seedMany([['A', 'One'], ['B', 'Two'], ['C', 'Three']]);
    const y = currentYear();
    expect((await collectAll({ mode: 'search', kind: 'memberId', term: `GYM-${y}-000` }, 25)).rows).toHaveLength(3);
    expect((await collectAll({ mode: 'search', kind: 'memberId', term: `GYM-${y}-0002` }, 25)).rows.map((r) => r.firstName)).toEqual(['B']);
    expect((await collectAll({ mode: 'search', kind: 'mobile', term: '9100000001' }, 25)).rows.map((r) => r.firstName)).toEqual(['B']);
    expect((await collectAll({ mode: 'search', kind: 'mobile', term: '91000' }, 25)).rows).toHaveLength(3);
    const b = (await collectAll({ mode: 'search', kind: 'mobile', term: '9100000001' }, 25)).rows[0] as Member;
    await softDeleteMemberTx({ db: admin, memberDocId: b.id, actor: adminActor });
    expect((await collectAll({ mode: 'search', kind: 'mobile', term: '91000' }, 25)).rows).toHaveLength(2);
    expect((await collectAll({ mode: 'search', kind: 'name', term: 'b' }, 25)).rows).toHaveLength(0);
  });

  it('server-side status filters: with no memberships everyone has no membership and nobody is suspended', async () => {
    await seedMany([['A', 'One'], ['B', 'Two']]);
    expect((await collectAll(browseQuery('NO_MEMBERSHIP'), 25)).rows).toHaveLength(2);
    expect((await collectAll(browseQuery('SUSPENDED'), 25)).rows).toHaveLength(0);
  });
});

describe('dashboard aggregations (US-2.12)', () => {
  it('counts non-deleted members and groups new members by IST joining month', async () => {
    const clock = () => new Date('2026-09-19T10:00:00Z');
    await register(admin, adminActor, { firstName: 'A', mobile: '9100000001', joiningDate: fromCivilDate(2026, 9, 1) }); // 1st -> September
    await register(admin, adminActor, { firstName: 'B', mobile: '9100000002', joiningDate: fromCivilDate(2026, 8, 31) }); // last of Aug
    await register(admin, adminActor, { firstName: 'C', mobile: '9100000003', joiningDate: fromCivilDate(2025, 10, 1) }); // oldest month in range
    await register(admin, adminActor, { firstName: 'D', mobile: '9100000004', joiningDate: fromCivilDate(2025, 9, 30) }); // outside the 12 months
    const gone = await register(admin, adminActor, { firstName: 'E', mobile: '9100000005', joiningDate: fromCivilDate(2026, 9, 2) });
    await softDeleteMemberTx({ db: admin, memberDocId: gone.memberDocId, actor: adminActor });

    expect(await countMembers(admin)).toBe(4);
    const months = await newMembersByMonth(admin, clock);
    expect(months).toHaveLength(12);
    const byLabel = Object.fromEntries(months.map((m) => [m.label, m.count]));
    expect(byLabel['Sep 2026']).toBe(1);
    expect(byLabel['Aug 2026']).toBe(1);
    expect(byLabel['Oct 2025']).toBe(1);
    expect(months.reduce((n, m) => n + m.count, 0)).toBe(3); // D is outside, E is deleted
  });
});
