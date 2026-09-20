import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assignCommit, END, MEM, paymentCommit, planBody, PRICE, seedMemberWithMembership, voidCommit } from './fixtures';
import { auditBody, createTestEnv, dbFor, memberUpdate, registerBatch, seedMember, seedUsers } from './setup';

/**
 * Audit atomicity (architecture 3.4, R-1, FR-13, AC-15): a members / memberships / payments document cannot be written unless an
 * audit record ABOUT it (right entity, right id, right action) is created in the SAME commit. `lastAuditId` names that record;
 * an older record cannot be re-used because the rules require `at == request.time`.
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
});

async function seedOldAudit(id: string, entity: string, entityId: string, action: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as never, 'auditLogs', id), { ...auditBody('admin', action, entity, entityId), at: Timestamp.fromDate(new Date('2026-01-01')) });
  });
}

describe('members: register (create) needs its MEMBER_CREATED audit record in the same commit', () => {
  it('the complete commit is allowed', async () => {
    await assertSucceeds(registerBatch(dbFor(env, 'admin'), { uid: 'admin' }).commit());
  });

  it('without the audit record it is denied', async () => {
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', omitAudit: true }).commit());
    await assertFails(registerBatch(dbFor(env, 'staff'), { uid: 'staff', omitAudit: true }).commit());
  });

  it('a record about another entity, another id or another action is denied', async () => {
    const admin = dbFor(env, 'admin');
    for (const bad of [
      { action: 'MEMBER_UPDATED' },
      { action: 'PAYMENT_CREATED' },
      { entity: 'plan', action: 'PLAN_CREATED' },
      { entityId: 'someoneElse' },
    ]) {
      await env.clearFirestore();
      await seedUsers(env);
      const batch = registerBatch(admin, { uid: 'admin', omitAudit: true });
      batch.set(doc(admin, 'auditLogs', 'audit-mem1'), auditBody('admin', 'MEMBER_CREATED', 'member', 'mem1', bad));
      await assertFails(batch.commit());
    }
  });

  it('an OLD audit record cannot be re-used (it was not created in this commit)', async () => {
    await seedOldAudit('old1', 'member', 'mem1', 'MEMBER_CREATED');
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', omitAudit: true, overrides: { lastAuditId: 'old1' } }).commit());
  });

  it('a lastAuditId that names a record that does not exist is denied', async () => {
    await assertFails(registerBatch(dbFor(env, 'admin'), { uid: 'admin', omitAudit: true, overrides: { lastAuditId: 'ghost' } }).commit());
  });
});

describe('members: update (edit, delete, suspend, reactivate, assign) needs an audit record about that action', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env);
  });

  const admin = () => dbFor(env, 'admin');
  const suspend = { suspended: true, suspendedAt: serverTimestamp(), suspendedReason: null, suspendedBy: 'admin' };
  const del = { deleted: true, deletedAt: serverTimestamp(), deletedBy: 'admin' };

  it('each action is allowed with its own audit record', async () => {
    await assertSucceeds(memberUpdate(admin(), 'admin', MEM, { address: '12 MG Road' }, { action: 'MEMBER_UPDATED' }));
    await assertSucceeds(memberUpdate(admin(), 'admin', MEM, { ...suspend, lastAuditId: 'a3' }, { action: 'MEMBER_SUSPENDED' }));
    await assertSucceeds(
      memberUpdate(admin(), 'admin', MEM, { suspended: false, suspendedAt: null, suspendedReason: null, suspendedBy: null, lastAuditId: 'a4' }, { action: 'MEMBER_REACTIVATED' }),
    );
    await assertSucceeds(memberUpdate(admin(), 'admin', MEM, { ...del, lastAuditId: 'a5' }, { action: 'MEMBER_DELETED' }));
  });

  it('every action WITHOUT its audit record is denied', async () => {
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x' }, { omitAudit: true }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, suspend, { omitAudit: true }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, del, { omitAudit: true }));
  });

  it('an audit record for a DIFFERENT action is denied (a delete cannot be logged as an edit, and vice versa)', async () => {
    await assertFails(memberUpdate(admin(), 'admin', MEM, del, { action: 'MEMBER_UPDATED' }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x' }, { action: 'MEMBER_DELETED' }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, suspend, { action: 'MEMBER_REACTIVATED' }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x' }, { action: 'PAYMENT_CREATED', entity: 'payment' }));
  });

  it('an audit record about ANOTHER member or another entity is denied', async () => {
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x' }, { entityId: 'mem2' }));
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x' }, { entity: 'plan' }));
  });

  it('an OLD audit record cannot be re-used for a new write', async () => {
    await seedOldAudit('old2', 'member', MEM, 'MEMBER_UPDATED');
    await assertFails(memberUpdate(admin(), 'admin', MEM, { address: 'x', lastAuditId: 'old2' }, { omitAudit: true }));
  });

  it('a renewal is audited as a MEMBERSHIP record about the NEW membership; a member-entity record or a stale id is denied', async () => {
    const before = { hasMembership: true, endDate: END, pendingPaise: PRICE };
    await assertSucceeds(assignCommit(admin(), 'admin', { before, membershipId: 'ms2' }));
  });

  it('a renewal without its audit, with the wrong action, or about another membership is denied', async () => {
    const before = { hasMembership: true, endDate: END, pendingPaise: PRICE };
    await assertFails(assignCommit(admin(), 'admin', { before, omitAudit: true }));
    await assertFails(assignCommit(admin(), 'admin', { before, auditAction: 'MEMBER_UPDATED' }));
    await assertFails(assignCommit(admin(), 'admin', { before, auditEntityId: 'ms-other' }));
  });
});

describe('memberships: create needs its MEMBERSHIP_* audit record (assign / renew)', () => {
  beforeEach(async () => {
    await seedMember(env, { docId: MEM });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as never, 'membershipPlans', 'plan1'), planBody());
    });
  });

  it('complete commit allowed; without the record, or with a payment / member record instead, denied', async () => {
    await assertSucceeds(assignCommit(dbFor(env, 'admin'), 'admin'));
    await env.clearFirestore();
    await seedUsers(env);
    await seedMember(env, { docId: MEM });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as never, 'membershipPlans', 'plan1'), planBody());
    });
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { omitAudit: true }));
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { auditAction: 'PAYMENT_CREATED' }));
    await assertFails(assignCommit(dbFor(env, 'admin'), 'admin', { auditEntityId: 'other' }));
  });
});

describe('payments: create and void need their PAYMENT_* audit record', () => {
  beforeEach(async () => {
    await seedMemberWithMembership(env, { paidPaise: 50000 });
  });

  it('recording a payment without its audit record is denied (even though every balance is right)', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paidBefore: 50000, omitAudit: true }));
  });

  it('a payment audited as another action or about another payment id is denied', async () => {
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paidBefore: 50000, auditAction: 'PAYMENT_VOIDED' }));
    await assertFails(paymentCommit(dbFor(env, 'admin'), 'admin', { paidBefore: 50000, auditEntityId: 'p-other' }));
  });

  it('a void without its audit record, or logged as a creation, is denied', async () => {
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { omitAudit: true }));
    await assertFails(voidCommit(dbFor(env, 'admin'), 'admin', { auditAction: 'PAYMENT_CREATED' }));
    await assertSucceeds(voidCommit(dbFor(env, 'admin'), 'admin'));
  });
});
