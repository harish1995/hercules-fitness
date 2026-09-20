import { type Member } from '../types/member';
import { type Membership } from '../types/membership';
import { type Payment } from '../types/payment';
import { MEMBER_ID_PATTERN } from './memberId';

/**
 * Drift detection for the denormalized surfaces (architecture 2.7 "Drift containment", R-2). PURE and read-only: it takes the
 * documents as data and returns what does not add up; `scripts/reconcile.ts` reads them and prints the result. Nothing here
 * writes, and nothing here can repair: a mismatch is a diagnostic for a human, not an automatic fix.
 *
 * Source of truth: `payments` for money received, `memberships` for periods. Everything else is a copy that a transaction is
 * supposed to keep in step:
 *
 *   membership.paidPaise        = sum(non-voided payments of that membership)
 *   membership.outstandingPaise = amountPaise - paidPaise, and `unpaid` = outstanding > 0
 *   member.pendingPaise         = sum(outstandingPaise of the member's memberships)      (live members only)
 *   member.membership summary   = the member's LATEST membership (latest end date, D-5) and `hasMembership`
 *   counters/memberId-YYYY      = the highest sequence number issued that year; no duplicate `memberId`
 */

export interface CounterDoc {
  id: string;
  year: number;
  lastSeq: number;
}

export interface ReconcileInput {
  members: readonly Member[];
  memberships: readonly Membership[];
  payments: readonly Payment[];
  counters: readonly CounterDoc[];
}

export type DriftKind =
  | 'MEMBERSHIP_PAID_MISMATCH'
  | 'MEMBERSHIP_OUTSTANDING_MISMATCH'
  | 'MEMBERSHIP_UNPAID_FLAG_MISMATCH'
  | 'MEMBERSHIP_OVERPAID'
  | 'MEMBERSHIP_ORPHAN_MEMBER'
  | 'PAYMENT_ORPHAN_MEMBERSHIP'
  | 'PAYMENT_MEMBER_MISMATCH'
  | 'MEMBER_PENDING_MISMATCH'
  | 'MEMBER_SUMMARY_MISMATCH'
  | 'MEMBER_HAS_MEMBERSHIP_MISMATCH'
  | 'MEMBER_ID_DUPLICATE'
  | 'MEMBER_ID_FORMAT'
  | 'COUNTER_BEHIND'
  | 'COUNTER_AHEAD';

export interface Drift {
  kind: DriftKind;
  /** the document the finding is about (`collection/id`) */
  ref: string;
  /** a value read from the database, in paise / ids / dates, never a name or a mobile number */
  stored: string;
  /** what the source of truth says it should be */
  expected: string;
  /**
   * `info`: expected and harmless (a soft-deleted member's pending total is frozen because nothing may write a deleted
   * member, so it can legitimately differ). `error`: a real drift that a transaction bug or a manual edit caused.
   */
  severity: 'error' | 'info';
}

export interface ReconcileReport {
  drifts: Drift[];
  errors: number;
  infos: number;
  checked: { members: number; memberships: number; payments: number; counters: number };
}

const day = (d: Date | null): string => (d ? d.toISOString() : 'none');

/** The member's latest membership: greatest end date; a tie goes to the one created last (renewals never share an end date). */
function latestOf(list: readonly Membership[]): Membership | null {
  let best: Membership | null = null;
  for (const m of list) {
    if (
      best === null ||
      m.endDate.getTime() > best.endDate.getTime() ||
      (m.endDate.getTime() === best.endDate.getTime() && m.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = m;
    }
  }
  return best;
}

export function reconcile(input: ReconcileInput): ReconcileReport {
  const drifts: Drift[] = [];
  const add = (kind: DriftKind, ref: string, stored: string, expected: string, severity: Drift['severity'] = 'error') =>
    drifts.push({ kind, ref, stored, expected, severity });

  const memberById = new Map(input.members.map((m) => [m.id, m]));
  const membershipById = new Map(input.memberships.map((m) => [m.id, m]));

  // ---- payments -> memberships ----
  const paidByMembership = new Map<string, number>();
  for (const p of input.payments) {
    const ms = membershipById.get(p.membershipId);
    if (!ms) {
      add('PAYMENT_ORPHAN_MEMBERSHIP', `payments/${p.id}`, p.membershipId, 'an existing membership');
      continue;
    }
    if (ms.memberDocId !== p.memberDocId) {
      add('PAYMENT_MEMBER_MISMATCH', `payments/${p.id}`, p.memberDocId, ms.memberDocId);
    }
    if (!p.voided) paidByMembership.set(p.membershipId, (paidByMembership.get(p.membershipId) ?? 0) + p.amountPaise);
  }

  // ---- each membership's paid / outstanding / unpaid ----
  const outstandingByMember = new Map<string, number>();
  const membershipsByMember = new Map<string, Membership[]>();
  for (const ms of input.memberships) {
    const paid = paidByMembership.get(ms.id) ?? 0;
    const ref = `memberships/${ms.id}`;
    if (ms.paidPaise !== paid) add('MEMBERSHIP_PAID_MISMATCH', ref, `${ms.paidPaise}`, `${paid}`);
    if (paid > ms.amountPaise || ms.paidPaise > ms.amountPaise) add('MEMBERSHIP_OVERPAID', ref, `${Math.max(paid, ms.paidPaise)}`, `<= ${ms.amountPaise}`);
    if (ms.outstandingPaise !== ms.amountPaise - ms.paidPaise) {
      add('MEMBERSHIP_OUTSTANDING_MISMATCH', ref, `${ms.outstandingPaise}`, `${ms.amountPaise - ms.paidPaise}`);
    }
    if (ms.unpaid !== ms.outstandingPaise > 0) add('MEMBERSHIP_UNPAID_FLAG_MISMATCH', ref, `${ms.unpaid}`, `${ms.outstandingPaise > 0}`);
    if (!memberById.has(ms.memberDocId)) add('MEMBERSHIP_ORPHAN_MEMBER', ref, ms.memberDocId, 'an existing member');
    // the member-level expectation uses what the membership SHOULD owe (from payments), so one drift is not reported twice
    outstandingByMember.set(ms.memberDocId, (outstandingByMember.get(ms.memberDocId) ?? 0) + Math.max(0, ms.amountPaise - paid));
    const list = membershipsByMember.get(ms.memberDocId) ?? [];
    list.push(ms);
    membershipsByMember.set(ms.memberDocId, list);
  }

  // ---- each member's pending total and latest-membership summary ----
  for (const m of input.members) {
    const ref = `members/${m.id}`;
    const owned = membershipsByMember.get(m.id) ?? [];
    const pending = outstandingByMember.get(m.id) ?? 0;
    if (m.pendingPaise !== pending) {
      // a soft-deleted member is frozen (the rules refuse any write to it), so a void made afterwards leaves it behind: informational
      add('MEMBER_PENDING_MISMATCH', ref, `${m.pendingPaise}`, `${pending}`, m.deleted ? 'info' : 'error');
    }
    if (m.hasMembership !== owned.length > 0) add('MEMBER_HAS_MEMBERSHIP_MISMATCH', ref, `${m.hasMembership}`, `${owned.length > 0}`);
    const latest = latestOf(owned);
    if (latest) {
      const s = m.membership;
      if (s.membershipId !== latest.id || s.endDate?.getTime() !== latest.endDate.getTime() || s.planId !== latest.planId) {
        add('MEMBER_SUMMARY_MISMATCH', ref, `${s.membershipId ?? 'none'} ends ${day(s.endDate)}`, `${latest.id} ends ${day(latest.endDate)}`);
      }
    }
    if (!MEMBER_ID_PATTERN.test(m.memberId)) add('MEMBER_ID_FORMAT', ref, m.memberId, 'GYM-YYYY-NNNN');
  }

  // ---- member IDs and counters ----
  const seen = new Map<string, string>();
  const maxSeq = new Map<number, number>();
  for (const m of input.members) {
    const first = seen.get(m.memberId);
    if (first !== undefined) add('MEMBER_ID_DUPLICATE', `members/${m.id}`, m.memberId, `unique (also on members/${first})`);
    else seen.set(m.memberId, m.id);
    const match = /^GYM-(\d{4})-(\d+)$/.exec(m.memberId);
    if (match) {
      const year = Number(match[1]);
      maxSeq.set(year, Math.max(maxSeq.get(year) ?? 0, Number(match[2])));
    }
  }
  const counterByYear = new Map(input.counters.map((c) => [c.year, c]));
  for (const [year, seq] of maxSeq) {
    const c = counterByYear.get(year);
    if (!c) add('COUNTER_BEHIND', `counters/memberId-${year}`, 'missing', `>= ${seq}`);
    else if (c.lastSeq < seq) add('COUNTER_BEHIND', `counters/${c.id}`, `${c.lastSeq}`, `>= ${seq}`);
  }
  for (const c of input.counters) {
    // a counter ahead of every member is normal only when members were hard-deleted in the console; report it, it is a gap
    if (c.lastSeq > (maxSeq.get(c.year) ?? 0)) add('COUNTER_AHEAD', `counters/${c.id}`, `${c.lastSeq}`, `${maxSeq.get(c.year) ?? 0}`, 'info');
  }

  return {
    drifts,
    errors: drifts.filter((d) => d.severity === 'error').length,
    infos: drifts.filter((d) => d.severity === 'info').length,
    checked: { members: input.members.length, memberships: input.memberships.length, payments: input.payments.length, counters: input.counters.length },
  };
}

/** Human-readable lines for the console. Ids, paise and dates only: no names, mobile numbers, notes or medical data. */
export function formatReport(report: ReconcileReport): string[] {
  const { checked } = report;
  const lines = [
    `Checked ${checked.members} members, ${checked.memberships} memberships, ${checked.payments} payments, ${checked.counters} counters.`,
  ];
  if (report.drifts.length === 0) {
    lines.push('No drift found: every denormalized total matches the payments and memberships.');
    return lines;
  }
  for (const d of report.drifts) {
    lines.push(`${d.severity === 'error' ? 'DRIFT' : 'note '}  ${d.kind}  ${d.ref}  stored=${d.stored}  expected=${d.expected}`);
  }
  lines.push(`${report.errors} drift(s), ${report.infos} note(s). Nothing was changed: this script is read-only.`);
  return lines;
}
