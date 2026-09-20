import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { addIstDays, fromCivilDate, istDayKey, todayIstStart, toCivilDate } from '../../src/domain/dates';
import { attendanceDocId } from '../../src/domain/attendance';

/**
 * A large, INTERNALLY CONSISTENT dataset for the read-cost measurement (US-8.3a), written straight to the emulator with the rules
 * disabled (a client cannot write 30,000 documents through the rules in a reasonable time, and this is emulator-only test data).
 * Consistency is the same as the app's: pendingPaise = sum of memberships' outstanding, paid = sum of non-voided payments, the
 * member summary points at the latest membership, member IDs come from one counter. The reconcile check is run on it by the test.
 *
 * Shape (for N members): about 60% ACTIVE, 8% EXPIRING_SOON, 22% EXPIRED, 4% SUSPENDED, 6% NO_MEMBERSHIP; 3% soft-deleted; 4 plans;
 * every 7th member has an older unpaid membership too (dues carry forward); 70% paid in full, 20% partial, 10% unpaid, 1% of the
 * payments voided; payments spread over the last 12 IST months; attendance on each of the last 30 days for 1 in 60 members.
 */
export const PLANS = [
  { id: 'plan-monthly', name: 'Monthly', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, days: 30 },
  { id: 'plan-quarterly', name: 'Quarterly', durationValue: 3, durationUnit: 'MONTHS', pricePaise: 400000, days: 90 },
  { id: 'plan-annual', name: 'Annual', durationValue: 12, durationUnit: 'MONTHS', pricePaise: 1200000, days: 365 },
  { id: 'plan-pass', name: '10-Day Pass', durationValue: 10, durationUnit: 'DAYS', pricePaise: 60000, days: 10 },
] as const;

const FIRST = ['Rahul', 'Sita', 'Amit', 'Priya', 'Vikram', 'Neha', 'Arjun', 'Meera', 'Kabir', 'Anil', 'Sam', 'Ravi', 'Tara', 'Isha', 'Dev'];
const LAST = ['Sharma', 'Verma', 'Kapoor', 'Iyer', 'Nair', 'Rao', 'Khan', 'Gupta', 'Mehta', 'Joshi', 'Singh', 'Das', 'Patel', 'Reddy', 'Bose'];
const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;

export interface DatasetStats {
  members: number;
  liveMembers: number;
  memberships: number;
  payments: number;
  attendance: number;
  today: string;
  byStatus: Record<string, number>;
}

type Doc = { path: [string, string]; data: Record<string, unknown> };

const ts = (d: Date) => Timestamp.fromDate(d);
const pad = (n: number) => String(n).padStart(4, '0');

export function buildDataset(memberCount: number, now: Date = new Date()): { docs: Doc[]; stats: DatasetStats } {
  const today = todayIstStart(() => now);
  const year = toCivilDate(today).year;
  const docs: Doc[] = [];
  const byStatus: Record<string, number> = { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, SUSPENDED: 0, NO_MEMBERSHIP: 0 };
  let memberships = 0;
  let payments = 0;
  let attendance = 0;
  let live = 0;
  const stamp = ts(now);

  for (const p of PLANS) {
    docs.push({
      path: ['membershipPlans', p.id],
      data: {
        name: p.name, nameLower: p.name.toLowerCase(), durationValue: p.durationValue, durationUnit: p.durationUnit, pricePaise: p.pricePaise,
        description: null, active: true, createdAt: stamp, createdBy: 'admin', updatedAt: stamp, updatedBy: 'admin',
      },
    });
  }
  docs.push({ path: ['counters', `memberId-${year}`], data: { year, lastSeq: memberCount, lastMemberDocId: `m${memberCount}`, updatedAt: stamp, updatedBy: 'admin' } });

  for (let i = 1; i <= memberCount; i++) {
    const memberDocId = `m${i}`;
    const memberId = `GYM-${year}-${pad(i)}`;
    const first = FIRST[i % FIRST.length] as string;
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length] as string;
    const displayName = `${first} ${last}`;
    const mobile = `9${String(100_000_000 + i)}`;
    const deleted = i % 33 === 0;
    const cls = i % 100;
    const kind = cls < 60 ? 'ACTIVE' : cls < 68 ? 'EXPIRING_SOON' : cls < 90 ? 'EXPIRED' : cls < 94 ? 'SUSPENDED' : 'NO_MEMBERSHIP';
    const suspended = kind === 'SUSPENDED';
    const plan = PLANS[i % PLANS.length] as (typeof PLANS)[number];
    // joining dates spread over the last 24 IST months
    const joining = addIstDays(today, -((i * 37) % 730) - 1);

    // ---- the main membership ----
    let endOffset = 0;
    if (kind === 'ACTIVE') endOffset = 10 + (i % 80);
    else if (kind === 'EXPIRING_SOON') endOffset = i % 8; // 0..7
    else if (kind === 'EXPIRED') endOffset = -(1 + (i % 200));
    else if (kind === 'SUSPENDED') endOffset = 5 + (i % 60);
    const hasMembership = kind !== 'NO_MEMBERSHIP';
    let pending = 0;
    let summary: Record<string, unknown> = { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null };

    if (hasMembership) {
      const end = addIstDays(today, endOffset);
      const start = addIstDays(end, -(plan.days - 1));
      const msId = `ms${i}`;
      const payClass = i % 10; // 0-6 paid, 7-8 partial, 9 unpaid
      const intended = payClass <= 6 ? plan.pricePaise : payClass <= 8 ? Math.floor(plan.pricePaise / 2) : 0;
      const voided = intended > 0 && i % 97 === 0;
      const paid = voided ? 0 : intended;
      // payments spread over the last 12 IST months (never in the future)
      const effectivePayDate = addIstDays(today, -((i * 11) % 360));
      docs.push({
        path: ['memberships', msId],
        data: {
          memberDocId, memberId, memberDisplayName: displayName, planId: plan.id, planName: plan.name, planDurationValue: plan.durationValue,
          planDurationUnit: plan.durationUnit, startDate: ts(start), endDate: ts(end), amountPaise: plan.pricePaise, paidPaise: paid,
          outstandingPaise: plan.pricePaise - paid, unpaid: plan.pricePaise - paid > 0, createdAt: ts(start), createdBy: 'admin',
          updatedAt: ts(start), updatedBy: 'admin', lastAuditId: `a-${msId}`,
        },
      });
      memberships++;
      pending += plan.pricePaise - paid;
      if (intended > 0) {
        docs.push({
          path: ['payments', `p${i}`],
          data: {
            memberDocId, memberId, memberDisplayName: displayName, membershipId: msId, amountPaise: intended, paymentDate: ts(effectivePayDate),
            method: METHODS[i % METHODS.length], transactionReference: null, notes: null, voided, voidReason: voided ? 'entered twice' : null,
            voidedAt: voided ? stamp : null, voidedBy: voided ? 'admin' : null, createdAt: ts(effectivePayDate), createdBy: 'admin',
            createdByName: 'Owner', lastAuditId: `a-p${i}`,
          },
        });
        payments++;
      }
      summary = { membershipId: msId, planId: plan.id, planName: plan.name, startDate: ts(start), endDate: ts(end), amountPaise: plan.pricePaise };

      // an older, unpaid membership (dues carry forward) for every 7th member
      if (i % 7 === 0) {
        const oldEnd = addIstDays(start, -1);
        const oldStart = addIstDays(oldEnd, -29);
        docs.push({
          path: ['memberships', `ms${i}-old`],
          data: {
            memberDocId, memberId, memberDisplayName: displayName, planId: 'plan-monthly', planName: 'Monthly', planDurationValue: 1,
            planDurationUnit: 'MONTHS', startDate: ts(oldStart), endDate: ts(oldEnd), amountPaise: 150000, paidPaise: 0, outstandingPaise: 150000,
            unpaid: true, createdAt: ts(oldStart), createdBy: 'admin', updatedAt: ts(oldStart), updatedBy: 'admin', lastAuditId: `a-ms${i}-old`,
          },
        });
        memberships++;
        pending += 150000;
      }
    }

    docs.push({
      path: ['members', memberDocId],
      data: {
        memberId, memberIdYear: year, firstName: first, lastName: last, displayName, gender: i % 2 ? 'MALE' : 'FEMALE', dateOfBirth: ts(fromCivilDate(1990 + (i % 10), 1 + (i % 12), 1 + (i % 28))),
        mobile, email: null, address: null, emergencyContact: null, trainerId: null, trainerName: null, joiningDate: ts(joining), generalNotes: null,
        hasPhoto: false, searchFullName: displayName.toLowerCase(), searchReverseName: `${last} ${first}`.toLowerCase(), searchMobile: mobile,
        suspended, suspendedAt: suspended ? stamp : null, suspendedReason: null, suspendedBy: suspended ? 'admin' : null,
        deleted, deletedAt: deleted ? stamp : null, deletedBy: deleted ? 'admin' : null, hasMembership, membership: summary, pendingPaise: pending,
        consent: { given: true, at: stamp, byUid: 'admin', byName: 'Owner', version: 'consent-v1', guardianConsent: false },
        createdAt: ts(joining), createdBy: 'admin', updatedAt: ts(joining), updatedBy: 'admin', lastAuditId: `a-m${i}`,
      },
    });
    if (!deleted) {
      live++;
      byStatus[kind] = (byStatus[kind] ?? 0) + 1;
    }

    // ---- attendance: the last 30 days (today included) for 1 in 60 members ----
    if (hasMembership && !deleted && !suspended) {
      for (let back = 0; back < 30; back++) {
        if ((i + back) % 60 !== 0) continue;
        const date = addIstDays(today, -back);
        const inAt = new Date(date.getTime() + (7 * 60 + (i % 300)) * 60_000);
        const out = back === 0 ? i % 2 === 0 : true; // half of today's are still in
        docs.push({
          path: ['attendance', attendanceDocId(memberDocId, date)],
          data: {
            memberDocId, memberId, memberName: displayName, date: ts(date), dateKey: istDayKey(date), status: 'PRESENT', checkInAt: ts(inAt),
            checkOutAt: out ? ts(new Date(inAt.getTime() + 3_600_000)) : null, checkedOut: out, createdAt: ts(inAt), createdBy: 'staff',
            updatedAt: ts(inAt), updatedBy: 'staff',
          },
        });
        attendance++;
      }
    }
  }

  return {
    docs,
    stats: { members: memberCount, liveMembers: live, memberships, payments, attendance, today: today.toISOString(), byStatus },
  };
}

/** Write with the rules disabled, 450 per batch (the limit is 500 operations). */
export async function writeDataset(env: RulesTestEnvironment, docs: Doc[]): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 450)) batch.set(doc(db, d.path[0], d.path[1]), d.data);
      await batch.commit();
    }
  });
}
