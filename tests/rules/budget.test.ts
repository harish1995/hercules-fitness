import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fromCivilDate } from '../../src/domain/dates';
import { checkInTx } from '../../src/services/attendanceTransactions';
import { newMembershipDocId, renewMembershipTx } from '../../src/services/membershipTransactions';
import { newMemberDocId, registerMemberTx } from '../../src/services/memberTransactions';
import { newPaymentDocId, recordPaymentTx, voidPaymentTx } from '../../src/services/paymentTransactions';
import { createPlanTx, newPlanDocId } from '../../src/services/planTransactions';
import { type Actor, type MemberProfileInput } from '../../src/types/member';
import { type PaymentDetails } from '../../src/types/payment';
import { PROJECT_ID, dbFor, seedUsers } from './setup';

/**
 * Rules budget (architecture 3.2 cost note, R-9). Firestore limits a rule evaluation to 1000 expressions and a commit to 10 document
 * access calls per operation / 20 per multi-document commit (get / exists / getAfter / existsAfter). The emulator ENFORCES these, so
 * "the heaviest commit succeeds" proves it fits. Then, to measure how close it is, the SAME scenario is re-run against a copy of the
 * rules with `k` extra document-access calls injected into the rule that is evaluated (each `!exists(/pad/<i>)` is one more distinct
 * document access): the largest `k` that still commits is the headroom. The numbers are printed and asserted as a floor, so a rule
 * change that eats the headroom fails here instead of failing in production.
 */
const RULES = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const admin: Actor = { uid: 'admin', name: 'Owner', role: 'ADMIN' };
const staff: Actor = { uid: 'staff', name: 'Desk', role: 'STAFF' };

const profile: MemberProfileInput = {
  firstName: 'Rahul', lastName: 'Sharma', gender: 'MALE', dateOfBirth: fromCivilDate(1995, 5, 10), mobile: '9876543210', email: 'rahul@example.com',
  address: '12 MG Road', emergencyContact: { name: 'Sita', mobile: '9123456780' }, trainerId: null, joiningDate: fromCivilDate(2026, 1, 15), generalNotes: 'notes',
};
const today = () => new Date();
const pay = (amountPaise: number): PaymentDetails => ({ amountPaise, method: 'UPI', paymentDate: fromCivilDate(2026, 1, 20), transactionReference: 'UPI-1', notes: null });

let env: RulesTestEnvironment | null = null;
async function freshEnv(rules: string): Promise<RulesTestEnvironment> {
  if (env) await env.cleanup();
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [host, port] = raw.split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: host ?? '127.0.0.1', port: Number(port ?? 8080), rules } });
  await env.clearFirestore();
  await seedUsers(env);
  return env;
}
afterAll(async () => {
  if (env) await env.cleanup();
});

/** Rules with `k` extra distinct document accesses added to one rule (`marker` is a unique line of that rule). */
function padded(k: number, marker: string, kind: 'access' | 'expr' = 'access'): string {
  const pads = Array.from({ length: k }, (_v, i) => (kind === 'access' ? ` && !exists(/databases/$(database)/documents/pad/p${i})` : ' && true')).join('');
  if (!RULES.includes(marker)) throw new Error(`marker not found in firestore.rules: ${marker}`);
  return RULES.replace(marker, `${marker}${pads}`);
}

async function mkPlan(e: RulesTestEnvironment) {
  const db = dbFor(e, 'admin');
  const planDocId = newPlanDocId(db);
  await createPlanTx({ db, planDocId, actor: admin, input: { name: 'Monthly', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, description: null, active: true } });
  return { db, planId: planDocId };
}

interface Scenario {
  name: string;
  /** a line of the rule the padding is appended to */
  marker: string;
  /** where trivial `&& true` expressions are appended to measure the 1000-expression headroom (only where it is the tighter limit) */
  exprMarker?: string;
  run: (e: RulesTestEnvironment) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    // registration + plan + FIRST PAYMENT + medical notes: 8 documents in one commit (counter, member, medical, membership, payment, 3 audits)
    name: 'registration with plan, first payment and medical notes (Admin): 8 documents, 3 audit records',
    marker: "&& auditAbout(d.lastAuditId, 'member', memberDocId, ['MEMBER_CREATED'])",
    exprMarker: "&& auditAbout(d.lastAuditId, 'member', memberDocId, ['MEMBER_CREATED'])",
    run: async (e) => {
      const { db, planId } = await mkPlan(e);
      await registerMemberTx({
        db, memberDocId: newMemberDocId(db), actor: admin, duplicateMobileConfirmed: true,
        input: { profile, medicalNotes: 'asthma', consentGiven: true, guardianConsent: false, membership: { planId, startDate: fromCivilDate(2026, 9, 1), firstPayment: pay(50000) } },
      });
    },
  },
  {
    // TX-4: payment + membership paid/outstanding/unpaid + member pendingPaise + audit
    name: 'TX-4 recordPayment: payment + membership + member + audit',
    marker: "&& auditAbout(request.resource.data.lastAuditId, 'payment', paymentId, ['PAYMENT_CREATED'])",
    exprMarker: "&& auditAbout(request.resource.data.lastAuditId, 'payment', paymentId, ['PAYMENT_CREATED'])",
    run: async (e) => {
      const { db, planId } = await mkPlan(e);
      const memberDocId = newMemberDocId(db);
      await registerMemberTx({
        db, memberDocId, actor: admin, duplicateMobileConfirmed: true,
        input: { profile, medicalNotes: null, consentGiven: true, guardianConsent: false, membership: { planId, startDate: fromCivilDate(2026, 9, 1) } },
      });
      const membershipId = (await getDoc(doc(db, 'members', memberDocId))).data()?.membership.membershipId as string;
      await recordPaymentTx({ db, paymentDocId: newPaymentDocId(db), memberDocId, membershipId, details: pay(50000), actor: admin });
    },
  },
  {
    name: 'TX-5 voidPayment: payment + membership + member + audit',
    marker: "&& auditAbout(request.resource.data.lastAuditId, 'payment', paymentId, ['PAYMENT_VOIDED'])",
    run: async (e) => {
      const { db, planId } = await mkPlan(e);
      const memberDocId = newMemberDocId(db);
      const r = await registerMemberTx({
        db, memberDocId, actor: admin, duplicateMobileConfirmed: true,
        input: { profile, medicalNotes: null, consentGiven: true, guardianConsent: false, membership: { planId, startDate: fromCivilDate(2026, 9, 1), firstPayment: pay(50000) } },
      });
      expect(r.alreadyExisted).toBe(false);
      const paymentId = (await getDocs(collection(db, 'payments'))).docs[0]?.id as string;
      await voidPaymentTx({ db, paymentId, reason: 'wrong member', actor: admin });
    },
  },
  {
    name: 'TX-2/TX-3 assign / renew with a first payment: membership + member + payment + 2 audits',
    // the members.update "assign / renew" branch: the assign / renew commit updates the member summary (audit check inside that branch)
    marker: "['MEMBERSHIP_CREATED', 'MEMBERSHIP_RENEWED']))",
    exprMarker: "['MEMBERSHIP_CREATED', 'MEMBERSHIP_RENEWED']))",
    run: async (e) => {
      const { db, planId } = await mkPlan(e);
      const memberDocId = newMemberDocId(db);
      await registerMemberTx({
        db, memberDocId, actor: admin, duplicateMobileConfirmed: true,
        input: { profile, medicalNotes: null, consentGiven: true, guardianConsent: false, membership: { planId, startDate: fromCivilDate(2026, 9, 1) } },
      });
      await renewMembershipTx({ db, memberDocId, planId, membershipDocId: newMembershipDocId(db), actor: admin, firstPayment: pay(50000), clock: today });
    },
  },
  {
    name: 'attendance check-in (Staff): attendance document + one member read in the rules',
    marker: 'allow create: if staffOrAdmin() && attendanceCreateOk(attendanceId, request.resource.data)',
    run: async (e) => {
      const { db } = await mkPlan(e);
      const memberDocId = newMemberDocId(db);
      await registerMemberTx({ db, memberDocId, actor: admin, duplicateMobileConfirmed: true, input: { profile, medicalNotes: null, consentGiven: true, guardianConsent: false } });
      await checkInTx({ db: dbFor(e, 'staff'), memberDocId, actor: staff, confirmed: true });
    },
  },
];

async function succeeds(rules: string, run: Scenario['run']): Promise<boolean> {
  const e = await freshEnv(rules);
  try {
    await run(e);
    return true;
  } catch (e) {
    if (process.env.BUDGET_DEBUG) console.error(e);
    return false;
  }
}

/** The number of extra distinct document accesses the rule can absorb before the commit is refused. */
async function headroom(s: Scenario, cap = 12): Promise<number> {
  let spare = 0;
  for (let k = 1; k <= cap; k++) {
    if (!(await succeeds(padded(k, s.marker), s.run))) break;
    spare = k;
  }
  return spare;
}

/** How many trivial `&& true` terms (about 2 expressions each) the evaluated rule can absorb before the 1000-expression limit. */
async function exprHeadroom(s: Scenario, step = 5, cap = 60): Promise<number> {
  if (!s.exprMarker) return -1;
  let spare = 0;
  for (let k = step; k <= cap; k += step) {
    if (!(await succeeds(padded(k, s.exprMarker, 'expr'), s.run))) break;
    spare = k;
  }
  return spare;
}

// A floor for the spare accesses on each heavy commit. If a rule change lowers the headroom below it, this fails and the change must
// follow the architecture's fallback order: drop the members.update audit check first, then the memberships one (section 3.4).
const MIN_SPARE = 2;
// ...and for the 1000-expression limit (in `&& true` terms, ~2 expressions each) on the rules that evaluate the most.
const MIN_EXPR_SPARE = 10;

describe('rules budget: the heaviest commits fit the document-access and expression limits (R-9)', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s: commits under the real rules (the emulator enforces the limits)', async (_name, s) => {
    expect(await succeeds(RULES, s.run)).toBe(true);
  });

  it('measured headroom: how many extra document accesses each heavy commit can still absorb', async () => {
    const report: string[] = [];
    for (const s of SCENARIOS) {
      const spare = await headroom(s);
      const expr = await exprHeadroom(s);
      report.push(`${String(spare).padStart(2)} spare accesses, ${expr < 0 ? ' n/a' : String(expr).padStart(3)}+ spare "&& true" terms  ${s.name}`);
      expect(spare, s.name).toBeGreaterThanOrEqual(MIN_SPARE);
      if (expr >= 0) expect(expr, s.name).toBeGreaterThanOrEqual(MIN_EXPR_SPARE);
    }
    console.info(`\nRULES HEADROOM (extra distinct doc accesses / trivial expressions that still commit; caps 12 and 60)\n${report.join('\n')}\n`);
  });
});
