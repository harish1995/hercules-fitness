import { describe, expect, it } from 'vitest';
import { type Member } from '../types/member';
import { type Membership } from '../types/membership';
import { type Payment } from '../types/payment';
import { fromCivilDate } from './dates';
import { formatReport, reconcile, type ReconcileInput } from './reconcile';

/** The read-only drift check (architecture 2.7, R-2): a consistent dataset reports nothing; each kind of corruption is named. */
const d = (y: number, m: number, day: number) => fromCivilDate(y, m, day);

const member = (over: Partial<Member> = {}): Member =>
  ({
    id: 'm1', memberId: 'GYM-2026-0001', deleted: false, suspended: false, hasMembership: true, pendingPaise: 100000,
    membership: { membershipId: 'ms1', planId: 'p1', planName: 'Monthly', startDate: d(2026, 9, 1), endDate: d(2026, 9, 30), amountPaise: 150000 },
    ...over,
  }) as Member;
const membership = (over: Partial<Membership> = {}): Membership =>
  ({
    id: 'ms1', memberDocId: 'm1', planId: 'p1', startDate: d(2026, 9, 1), endDate: d(2026, 9, 30), amountPaise: 150000, paidPaise: 50000,
    outstandingPaise: 100000, unpaid: true, createdAt: new Date('2026-09-01T05:00:00Z'), ...over,
  }) as Membership;
const payment = (over: Partial<Payment> = {}): Payment =>
  ({ id: 'p-1', memberDocId: 'm1', membershipId: 'ms1', amountPaise: 50000, voided: false, ...over }) as Payment;

const clean = (): ReconcileInput => ({
  members: [member()],
  memberships: [membership()],
  payments: [payment()],
  counters: [{ id: 'memberId-2026', year: 2026, lastSeq: 1 }],
});
const kinds = (input: ReconcileInput) => reconcile(input).drifts.map((x) => x.kind);

describe('reconcile', () => {
  it('a consistent dataset has no drift', () => {
    const r = reconcile(clean());
    expect(r.drifts).toEqual([]);
    expect(r.errors).toBe(0);
    expect(r.checked).toEqual({ members: 1, memberships: 1, payments: 1, counters: 1 });
    expect(formatReport(r).join('\n')).toMatch(/No drift found/);
  });

  it('a voided payment does not count towards paid', () => {
    const input = clean();
    input.payments = [payment(), payment({ id: 'p-2', amountPaise: 30000, voided: true })];
    expect(kinds(input)).toEqual([]);
  });

  it('paidPaise that is not the sum of the non-voided payments', () => {
    const input = clean();
    input.memberships = [membership({ paidPaise: 60000, outstandingPaise: 90000 })];
    expect(kinds(input)).toContain('MEMBERSHIP_PAID_MISMATCH');
  });

  it('outstanding that is not amount - paid, and an unpaid flag that contradicts outstanding', () => {
    const a = clean();
    a.memberships = [membership({ outstandingPaise: 90000 })];
    expect(kinds(a)).toContain('MEMBERSHIP_OUTSTANDING_MISMATCH');
    const b = clean();
    b.memberships = [membership({ unpaid: false })];
    expect(kinds(b)).toEqual(['MEMBERSHIP_UNPAID_FLAG_MISMATCH']);
  });

  it('overpayment', () => {
    const input = clean();
    input.payments = [payment({ amountPaise: 160000 })];
    input.memberships = [membership({ paidPaise: 160000, outstandingPaise: -10000, unpaid: false })];
    input.members = [member({ pendingPaise: 0 })];
    expect(kinds(input)).toContain('MEMBERSHIP_OVERPAID');
  });

  it('member.pendingPaise that is not the sum of the memberships\' outstanding (multi-membership, D-7)', () => {
    const input = clean();
    input.memberships = [membership(), membership({ id: 'ms2', paidPaise: 0, outstandingPaise: 150000, endDate: d(2026, 10, 31), createdAt: new Date('2026-09-20T05:00:00Z') })];
    input.members = [member({ pendingPaise: 100000, membership: { membershipId: 'ms2', planId: 'p1', planName: 'Monthly', startDate: d(2026, 10, 1), endDate: d(2026, 10, 31), amountPaise: 150000 } })];
    const r = reconcile(input);
    expect(r.drifts).toEqual([expect.objectContaining({ kind: 'MEMBER_PENDING_MISMATCH', stored: '100000', expected: '250000', severity: 'error' })]);
    input.members = [{ ...input.members[0]!, pendingPaise: 250000 }];
    expect(kinds(input)).toEqual([]);
  });

  it('a soft-deleted member\'s frozen pending total is only a note (nothing may write a deleted member)', () => {
    const input = clean();
    input.members = [member({ deleted: true, pendingPaise: 150000 })];
    const r = reconcile(input);
    expect(r.errors).toBe(0);
    expect(r.infos).toBe(1);
    expect(r.drifts[0]).toMatchObject({ kind: 'MEMBER_PENDING_MISMATCH', severity: 'info' });
  });

  it('the member summary must point at the LATEST membership (latest end date wins; ties go to the later created)', () => {
    const input = clean();
    input.memberships = [membership(), membership({ id: 'ms2', paidPaise: 0, outstandingPaise: 150000, endDate: d(2026, 10, 31), createdAt: new Date('2026-09-25T05:00:00Z') })];
    input.members = [member({ pendingPaise: 250000 })]; // summary still at ms1: stale
    expect(kinds(input)).toEqual(['MEMBER_SUMMARY_MISMATCH']);
  });

  it('hasMembership disagreeing with the memberships that exist', () => {
    const input = clean();
    input.members = [member({ hasMembership: false, pendingPaise: 100000 })];
    expect(kinds(input)).toContain('MEMBER_HAS_MEMBERSHIP_MISMATCH');
  });

  it('orphans: a payment for a missing membership, a payment filed under the wrong member, a membership of a missing member', () => {
    const input = clean();
    input.payments = [payment(), payment({ id: 'p-9', membershipId: 'ghost' }), payment({ id: 'p-8', memberDocId: 'm9', amountPaise: 1, voided: true })];
    input.memberships = [membership(), membership({ id: 'ms-x', memberDocId: 'nobody', paidPaise: 0, outstandingPaise: 150000, endDate: d(2020, 1, 1) })];
    const found = kinds(input);
    expect(found).toContain('PAYMENT_ORPHAN_MEMBERSHIP');
    expect(found).toContain('PAYMENT_MEMBER_MISMATCH');
    expect(found).toContain('MEMBERSHIP_ORPHAN_MEMBER');
  });

  it('duplicate member ids and a counter behind the highest issued number (duplicate-ID risk)', () => {
    const input = clean();
    input.members = [member(), member({ id: 'm2', hasMembership: false, pendingPaise: 0, membership: { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null } }), member({ id: 'm3', memberId: 'GYM-2026-0005', hasMembership: false, pendingPaise: 0, membership: { membershipId: null, planId: null, planName: null, startDate: null, endDate: null, amountPaise: null } })];
    const found = kinds(input);
    expect(found).toContain('MEMBER_ID_DUPLICATE');
    expect(found).toContain('COUNTER_BEHIND'); // counter says 1 but GYM-2026-0005 exists
  });

  it('a malformed member id, and a counter that is ahead (a gap: informational)', () => {
    const input = clean();
    input.members = [member({ memberId: 'GYM-26-1' })];
    input.counters = [{ id: 'memberId-2026', year: 2026, lastSeq: 9 }];
    const found = reconcile(input);
    expect(found.drifts.map((x) => x.kind)).toContain('MEMBER_ID_FORMAT');
    expect(found.drifts.find((x) => x.kind === 'COUNTER_AHEAD')?.severity).toBe('info');
  });

  it('the report carries ids, paise and dates only: no names, mobiles, notes or medical data', () => {
    const input = clean();
    input.members = [member({ pendingPaise: 1, displayName: 'Rahul Sharma', mobile: '9876543210', generalNotes: 'asthma' } as Partial<Member>)];
    const text = formatReport(reconcile(input)).join('\n');
    expect(text).toContain('MEMBER_PENDING_MISMATCH');
    for (const secret of ['Rahul', 'Sharma', '9876543210', 'asthma']) expect(text).not.toContain(secret);
  });

  it('never mutates its input (it is a diagnostic, not a repair)', () => {
    const input = clean();
    input.memberships = [membership({ paidPaise: 1 })];
    const snapshot = JSON.stringify(input);
    reconcile(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
