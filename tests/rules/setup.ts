import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// "demo-" project ids can never reach a real Firebase project.
export const PROJECT_ID = 'demo-hercules-fitness';

function emulatorHostPort(): { host: string; port: number } {
  // `firebase emulators:exec` exports FIRESTORE_EMULATOR_HOST=host:port
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run the rules tests through `npm run test:rules` ' +
        '(firebase emulators:exec), not with plain `vitest`.',
    );
  }
  const [host, port] = raw.split(':');
  return { host: host ?? '127.0.0.1', port: Number(port ?? 8080) };
}

// Denied writes are the point of these tests; keep the SDK's PERMISSION_DENIED stream logs out of the output.
setLogLevel('silent');

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  const { host, port } = emulatorHostPort();
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
}

/** Fixture users (architecture §3.5). Seeded with rules disabled. */
export async function seedUsers(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { displayName: 'Test', createdAt: new Date('2026-01-01T00:00:00Z') };
    await db.doc('users/admin').set({ ...base, email: 'admin@example.com', role: 'ADMIN', active: true });
    await db.doc('users/staff').set({ ...base, email: 'staff@example.com', role: 'STAFF', active: true });
    await db
      .doc('users/member1')
      .set({ ...base, email: 'm1@example.com', role: 'MEMBER', active: true, memberDocId: 'mem1' });
    await db
      .doc('users/member2')
      .set({ ...base, email: 'm2@example.com', role: 'MEMBER', active: true, memberDocId: 'mem2' });
    await db.doc('users/inactive').set({ ...base, email: 'off@example.com', role: 'ADMIN', active: false });
    // Malformed role documents (US-8.2b): every one must be denied everywhere. Roles are compared EXACTLY.
    await db.doc('users/unknownRole').set({ ...base, email: 'x1@example.com', role: 'SUPERADMIN', active: true });
    await db.doc('users/lowerRole').set({ ...base, email: 'x2@example.com', role: 'admin', active: true });
    await db.doc('users/paddedRole').set({ ...base, email: 'x3@example.com', role: 'ADMIN ', active: true });
    await db.doc('users/noRoleField').set({ ...base, email: 'x4@example.com', active: true });
    await db.doc('users/nullRole').set({ ...base, email: 'x5@example.com', role: null, active: true });
    await db.doc('users/arrayRole').set({ ...base, email: 'x6@example.com', role: ['ADMIN'], active: true });
    await db.doc('users/noActiveField').set({ ...base, email: 'x7@example.com', role: 'ADMIN' });
    await db.doc('users/stringActive').set({ ...base, email: 'x8@example.com', role: 'ADMIN', active: 'true' });
    // `noRole` deliberately has NO users doc.
  });
}

/** Paths from architecture §2.1 plus an unlisted one. */
export const COLLECTION_PATHS = [
  'users',
  'members',
  'memberMedical',
  'memberPhotos',
  'membershipPlans',
  'memberships',
  'payments',
  'attendance',
  'trainers',
  'counters',
  'auditLogs',
  'notifications',
  'settings',
  'metrics',
  'foo',
] as const;

// ---------------------------------------------------------------------------------------------------------
// Phase 2 helpers: modular-SDK access to the rules-unit-testing contexts, and raw document builders that mirror
// exactly what src/services/memberTransactions.ts writes (so a rule change that breaks the client is caught).
// ---------------------------------------------------------------------------------------------------------
import { doc, serverTimestamp, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';

/** A modular Firestore bound to a signed-in fixture user (or anonymous when uid is null). */
export function dbFor(env: RulesTestEnvironment, uid: string | null): Firestore {
  const ctx = uid === null ? env.unauthenticatedContext() : env.authenticatedContext(uid);
  return ctx.firestore() as unknown as Firestore;
}

/** 00:00 IST of a civil day as a Timestamp (18:30 UTC the day before). */
export function istMidnight(y: number, m: number, d: number): Timestamp {
  return Timestamp.fromMillis(Date.UTC(y, m - 1, d) - 19_800_000);
}

/** The IST calendar year now: the same year the app puts in the member ID. */
export function currentYear(): number {
  return new Date(Date.now() + 19_800_000).getUTCFullYear();
}

export const padSeq = (n: number): string => String(n).padStart(4, '0');

export interface MemberBuild {
  /** the uid that performs the write (createdBy / consent.byUid) */
  uid: string;
  year?: number;
  seq?: number;
  mobile?: string;
  overrides?: Record<string, unknown>;
}

/** A rule-valid members/{id} document exactly as TX-1 writes it. */
export function memberData(build: MemberBuild): Record<string, unknown> {
  const year = build.year ?? currentYear();
  const seq = build.seq ?? 1;
  const mobile = build.mobile ?? '9876543210';
  return {
    memberId: `GYM-${year}-${padSeq(seq)}`,
    memberIdYear: year,
    firstName: 'Rahul',
    lastName: 'Sharma',
    displayName: 'Rahul Sharma',
    gender: 'MALE',
    dateOfBirth: istMidnight(1995, 5, 10),
    mobile,
    email: null,
    address: null,
    emergencyContact: null,
    trainerId: null,
    trainerName: null,
    joiningDate: istMidnight(2026, 1, 15),
    generalNotes: null,
    hasPhoto: false,
    searchFullName: 'rahul sharma',
    searchReverseName: 'sharma rahul',
    searchMobile: mobile,
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    hasMembership: false,
    membership: { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null },
    pendingPaise: 0,
    consent: {
      given: true,
      at: serverTimestamp(),
      byUid: build.uid,
      byName: 'Tester',
      version: 'consent-v1',
      guardianConsent: false,
    },
    createdAt: serverTimestamp(),
    createdBy: build.uid,
    updatedAt: serverTimestamp(),
    updatedBy: build.uid,
    lastAuditId: 'audit1',
    ...build.overrides,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Audit atomicity (architecture 3.4): a members / memberships / payments write must come with an audit record created in the
// SAME commit, about that document. These builders write both, exactly as the app's transactions do.
// ---------------------------------------------------------------------------------------------------------
export const ROLE_OF: Record<string, string> = { admin: 'ADMIN', staff: 'STAFF' };

/** A rule-valid auditLogs body written by `uid` (the actor role must equal the role in users/{uid}). */
export function auditBody(uid: string, action: string, entity: string, entityId: string, over: Record<string, unknown> = {}) {
  return {
    actorUid: uid,
    actorName: 'Tester',
    actorRole: ROLE_OF[uid] ?? 'ADMIN',
    action,
    entity,
    entityId,
    entityLabel: 'GYM-2026-0001 Rahul Sharma',
    at: serverTimestamp(),
    metadata: {},
    ...over,
  };
}

/** Add the audit record a document names in `lastAuditId` to a batch. */
export function addAudit(
  batch: ReturnType<typeof writeBatch>,
  db: Firestore,
  uid: string,
  id: string,
  action: string,
  entity: string,
  entityId: string,
  over: Record<string, unknown> = {},
): void {
  batch.set(doc(db, 'auditLogs', id), auditBody(uid, action, entity, entityId, over));
}

export interface MemberUpdateOptions {
  /** what the audit record says (defaults: a MEMBER_UPDATED record about this member) */
  action?: string;
  entity?: string;
  entityId?: string;
  /** do not write the audit record at all */
  omitAudit?: boolean;
  /** extra fields on the audit record (e.g. a client-clock `at`) */
  auditOver?: Record<string, unknown>;
}

/** A members/{docId} update plus its audit record in ONE commit. `fields.lastAuditId` (default `a2`) names the audit record. */
export function memberUpdate(
  db: Firestore,
  uid: string,
  docId: string,
  fields: Record<string, unknown>,
  o: MemberUpdateOptions = {},
) {
  const data = { updatedAt: serverTimestamp(), updatedBy: uid, lastAuditId: 'a2', ...fields };
  const batch = writeBatch(db);
  batch.update(doc(db, 'members', docId), data);
  if (!o.omitAudit) {
    addAudit(batch, db, uid, String(data.lastAuditId), o.action ?? 'MEMBER_UPDATED', o.entity ?? 'member', o.entityId ?? docId, o.auditOver);
  }
  return batch.commit();
}

export interface RegisterBatchOptions extends MemberBuild {
  docId?: string;
  /** the counter value written in this commit (default = seq) */
  counterSeq?: number;
  /** skip the counter write entirely */
  omitCounter?: boolean;
  /** skip the MEMBER_CREATED audit record (default: written in the same commit) */
  omitAudit?: boolean;
  /** the `lastMemberDocId` the counter names (default = docId, i.e. this member) */
  counterNames?: string;
}

/** The whole registration commit (counter naming the new member + the member) as a batch; the caller commits it. */
export function registerBatch(db: Firestore, o: RegisterBatchOptions) {
  const year = o.year ?? currentYear();
  const seq = o.seq ?? 1;
  const docId = o.docId ?? 'mem1';
  const batch = writeBatch(db);
  if (!o.omitCounter) {
    batch.set(doc(db, 'counters', `memberId-${year}`), {
      year,
      lastSeq: o.counterSeq ?? seq,
      lastMemberDocId: o.counterNames ?? docId,
      updatedAt: serverTimestamp(),
      updatedBy: o.uid,
    });
  }
  // each registration names its own audit record (`audit-<docId>`), so several can be committed in one test
  const auditId = typeof o.overrides?.lastAuditId === 'string' ? o.overrides.lastAuditId : `audit-${docId}`;
  batch.set(doc(db, 'members', docId), memberData({ ...o, overrides: { lastAuditId: auditId, ...o.overrides } }));
  if (!o.omitAudit) addAudit(batch, db, o.uid, auditId, 'MEMBER_CREATED', 'member', docId);
  return batch;
}

/** Seed a member (and its counter) with rules disabled, for update / delete / read tests. */
export async function seedMember(
  env: RulesTestEnvironment,
  o: { docId?: string; seq?: number; mobile?: string; overrides?: Record<string, unknown> } = {},
): Promise<string> {
  const docId = o.docId ?? 'mem1';
  const year = currentYear();
  const seq = o.seq ?? 1;
  const mobile = o.mobile ?? '9876543210';
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const batch = writeBatch(db);
    batch.set(doc(db, 'counters', `memberId-${year}`), { year, lastSeq: seq, lastMemberDocId: docId, updatedAt: Timestamp.now(), updatedBy: 'admin' });
    const data = memberData({ uid: 'admin', seq, mobile, overrides: o.overrides });
    data.consent = { ...(data.consent as object), at: Timestamp.now() };
    data.createdAt = Timestamp.now();
    data.updatedAt = Timestamp.now();
    batch.set(doc(db, 'members', docId), data);
    await batch.commit();
  });
  return docId;
}

/** Fixture users whose users/{uid} document is missing or malformed: the rules must deny them EVERYTHING (US-8.2b). */
export const BROKEN_ROLE_UIDS = [
  'noRole', 'inactive', 'unknownRole', 'lowerRole', 'paddedRole', 'noRoleField', 'nullRole', 'arrayRole', 'noActiveField', 'stringActive',
] as const;
