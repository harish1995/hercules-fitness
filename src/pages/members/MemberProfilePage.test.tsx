import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../services/errors';
import { makeMember, renderPage } from '../../test/render';
import { MemberProfilePage } from './MemberProfilePage';

const mocks = vi.hoisted(() => ({
  getMember: vi.fn(),
  softDeleteMember: vi.fn(),
  getMemberPhoto: vi.fn(),
  saveMemberPhoto: vi.fn(),
  removeMemberPhoto: vi.fn(),
  getMemberMedical: vi.fn(),
  listMemberships: vi.fn(),
  listMemberPayments: vi.fn(),
  listMemberAttendance: vi.fn(),
  actor: { uid: 'u1', name: 'Owner', role: 'ADMIN' } as { uid: string; name: string; role: string },
}));
vi.mock('../../services/memberService', () => ({ getMember: mocks.getMember, softDeleteMember: mocks.softDeleteMember }));
vi.mock('../../services/memberPhotoService', () => ({
  getMemberPhoto: mocks.getMemberPhoto,
  saveMemberPhoto: mocks.saveMemberPhoto,
  removeMemberPhoto: mocks.removeMemberPhoto,
}));
vi.mock('../../services/membershipService', () => ({
  listMemberships: mocks.listMemberships,
  generateMembershipDocId: () => 'm-new',
  assignMembership: vi.fn(),
  renewMembership: vi.fn(),
  setSuspended: vi.fn(),
}));
vi.mock('../../services/paymentService', () => ({
  listMemberPayments: mocks.listMemberPayments,
  listUnpaidMemberships: vi.fn(async () => []),
  generatePaymentDocId: () => 'p-new',
  recordPayment: vi.fn(),
  voidPayment: vi.fn(),
}));
vi.mock('../../services/attendanceService', () => ({
  listMemberAttendance: mocks.listMemberAttendance,
  getTodayAttendance: vi.fn(async () => null),
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  markAbsent: vi.fn(),
}));
vi.mock('../../services/planService', () => ({ listPlans: vi.fn(async () => []) }));
vi.mock('../../services/memberMedicalService', () => ({ getMemberMedical: mocks.getMemberMedical }));
vi.mock('../../hooks/useActor', () => ({ useActor: () => mocks.actor }));

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m === 'function' && 'mockReset' in m && m.mockReset());
  mocks.actor = { uid: 'u1', name: 'Owner', role: 'ADMIN' };
  mocks.getMemberPhoto.mockResolvedValue(null);
  mocks.listMemberships.mockResolvedValue({ items: [], next: null });
  mocks.listMemberPayments.mockResolvedValue({ items: [], next: null });
  mocks.listMemberAttendance.mockResolvedValue({ items: [], next: null });
  mocks.getMemberMedical.mockResolvedValue({ notes: 'Asthma', updatedAt: new Date(), updatedBy: 'u1' });
});

const render = () => renderPage(<MemberProfilePage />, { path: '/members/:memberDocId', url: '/members/doc1' });

describe('MemberProfilePage (US-2.9)', () => {
  it('shows the profile, status badge, consent record, the real membership sections and explicit empty states', async () => {
    mocks.getMember.mockResolvedValue(makeMember({ address: '12 MG Road', trainerName: 'Amit' }));
    render();
    expect(await screen.findByRole('heading', { name: 'Rahul Sharma' })).toBeInTheDocument();
    expect(screen.getAllByText('GYM-2026-0001').length).toBeGreaterThan(0);
    expect(screen.getByText('No membership')).toBeInTheDocument();
    expect(screen.getByText('12 MG Road')).toBeInTheDocument();
    expect(screen.getByText('Amit')).toBeInTheDocument();
    expect(screen.getByText(/Recorded .* by Owner \(consent-v1\)/)).toBeInTheDocument();
    expect(await screen.findByText('No attendance yet')).toBeInTheDocument();
    // Phase 4: the payment history is real (Admin only)
    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
    // Phase 3: the membership sections are real (no membership yet / no memberships yet), with Assign plan for an Admin
    expect(screen.getByRole('region', { name: 'Membership' })).toHaveTextContent('No membership yet');
    expect(screen.getByRole('button', { name: 'Assign plan' })).toBeInTheDocument();
    expect(await screen.findByText('No memberships yet')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notes' })).toBeInTheDocument();
  });

  it('a missing or soft-deleted member shows "Member not found" (US-2.9c)', async () => {
    mocks.getMember.mockResolvedValue(null);
    render();
    expect(await screen.findByText('Member not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to members' })).toBeInTheDocument();
  });

  it('a load failure is a friendly retryable error', async () => {
    mocks.getMember.mockRejectedValue(new AppError('UNAVAILABLE'));
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  });

  it('shows "Under 18" computed from the DOB and labels the emergency contact as the guardian', async () => {
    const year = new Date().getFullYear() - 10;
    mocks.getMember.mockResolvedValue(
      makeMember({
        dateOfBirth: new Date(Date.UTC(year, 5, 15)),
        emergencyContact: { name: 'Parent', mobile: '9123456789' },
        consent: { ...makeMember().consent, guardianConsent: true },
      }),
    );
    render();
    expect(await screen.findByText('Under 18')).toBeInTheDocument();
    expect(screen.getByText('Guardian')).toBeInTheDocument();
    expect(screen.getByText('Guardian consent given')).toBeInTheDocument();
  });
});

describe('medical notes are Admin-only (US-2.6b)', () => {
  it('Admin sees the medical notes', async () => {
    mocks.getMember.mockResolvedValue(makeMember());
    render();
    expect(await screen.findByText('Asthma')).toBeInTheDocument();
  });

  it('Staff never requests nor sees the medical section, and has no Edit/Delete', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    mocks.getMember.mockResolvedValue(makeMember());
    render();
    await screen.findByRole('heading', { name: 'Rahul Sharma' });
    expect(mocks.getMemberMedical).not.toHaveBeenCalled();
    // payments are Admin only (matrix): Staff sees the pending amount but no payment history, and never requests it
    expect(screen.queryByRole('region', { name: 'Payment history' })).not.toBeInTheDocument();
    expect(mocks.listMemberPayments).not.toHaveBeenCalled();
    expect(screen.queryByText(/Medical notes/)).not.toBeInTheDocument();
    expect(screen.queryByText('Asthma')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('soft delete (US-2.11)', () => {
  it('asks for confirmation stating the effect; confirming soft-deletes and leaves the profile', async () => {
    mocks.getMember.mockResolvedValue(makeMember());
    mocks.softDeleteMember.mockResolvedValue(undefined);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('nothing is permanently erased');
    expect(mocks.softDeleteMember).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete member' }));
    await waitFor(() => expect(mocks.softDeleteMember).toHaveBeenCalledWith({ memberDocId: 'doc1', actor: mocks.actor }));
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument(); // navigated to the members list
  });

  it('offers no hard-delete option anywhere', async () => {
    mocks.getMember.mockResolvedValue(makeMember());
    render();
    await screen.findByRole('heading', { name: 'Rahul Sharma' });
    expect(screen.queryByText(/permanently delete|hard delete/i)).not.toBeInTheDocument();
  });
});

describe('photo (US-2.5d)', () => {
  it('if the registration photo failed (flag set, no photo doc) the profile offers to add it again', async () => {
    mocks.getMember.mockResolvedValue(makeMember({ hasPhoto: true }));
    render();
    expect(await screen.findByText(/could not be saved when this member was registered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
  });

  it('Staff cannot replace an existing photo (only add a first one)', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    mocks.getMember.mockResolvedValue(makeMember({ hasPhoto: true }));
    mocks.getMemberPhoto.mockResolvedValue({ dataUrl: 'data:image/webp;base64,QUJD', contentType: 'image/webp', bytes: 3, width: 8, height: 8 });
    render();
    expect(await screen.findByText('Only an Admin can replace an existing photo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change photo' })).not.toBeInTheDocument();
  });
});

describe('membership on the profile (US-3.13)', () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000);
  const withMembership = (endOffset: number, over = {}) =>
    makeMember({
      hasMembership: true,
      pendingPaise: 150000,
      membership: { membershipId: 'ms1', planId: 'p1', planName: 'Monthly', startDate: day(endOffset - 29), endDate: day(endOffset), amountPaise: 150000 },
      ...over,
    });

  it('shows the badge, plan, dates and days remaining derived from the stored end date', async () => {
    mocks.getMember.mockResolvedValue(withMembership(20));
    render();
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Membership' })).toHaveTextContent('Monthly');
    expect(screen.getByRole('region', { name: 'Membership' })).toHaveTextContent(/day(s)? left/);
    expect(screen.getByRole('button', { name: 'Renew' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });

  it('a suspended member shows Suspended and cannot be renewed until reactivated (NEW-7)', async () => {
    mocks.getMember.mockResolvedValue(withMembership(20, { suspended: true, suspendedReason: 'Travelling' }));
    render();
    expect((await screen.findAllByText('Suspended')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Renew' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.getByText(/Travelling/)).toBeInTheDocument();
  });

  it('Staff sees the membership but no Assign / Renew / Suspend', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    mocks.getMember.mockResolvedValue(withMembership(3));
    render();
    expect(await screen.findByText('Expiring soon')).toBeInTheDocument();
    for (const name of ['Renew', 'Suspend', 'Assign plan']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('membership history lists every membership newest first and offers no edit', async () => {
    mocks.getMember.mockResolvedValue(withMembership(20));
    const h = (id: string, plan: string) => ({
      id, memberDocId: 'doc1', memberId: 'GYM-2026-0001', memberDisplayName: 'Rahul Sharma', planId: 'p1', planName: plan,
      planDurationValue: 1, planDurationUnit: 'MONTHS', startDate: new Date('2026-01-01T00:00:00+05:30'), endDate: new Date('2026-01-31T00:00:00+05:30'),
      amountPaise: 150000, paidPaise: 0, outstandingPaise: 150000, unpaid: true, createdAt: new Date(), createdBy: 'u1',
    });
    mocks.listMemberships.mockResolvedValue({ items: [h('a', 'Newest plan'), h('b', 'Older plan')], next: null });
    render();
    const table = await screen.findByRole('table', { name: 'Membership history' });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Newest plan');
    expect(rows[1]).toHaveTextContent('Older plan');
    expect(table).toHaveTextContent('01/01/2026 to 31/01/2026');
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('photo remove and failure (D6)', () => {
  const stored = { dataUrl: 'data:image/webp;base64,QUJD', contentType: 'image/webp', bytes: 3, width: 8, height: 8 };

  it('Admin Remove asks for confirmation, then deletes the photo through removeMemberPhoto and reloads', async () => {
    mocks.getMember.mockResolvedValue(makeMember({ hasPhoto: true }));
    mocks.getMemberPhoto.mockResolvedValue(stored);
    mocks.removeMemberPhoto.mockResolvedValue(undefined);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mocks.removeMemberPhoto).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(mocks.removeMemberPhoto).toHaveBeenCalledWith({ memberDocId: 'doc1', actor: mocks.actor }));
    await waitFor(() => expect(mocks.getMemberPhoto.mock.calls.length).toBeGreaterThan(1)); // reloaded
  });

  it('Staff gets no Remove button', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    mocks.getMember.mockResolvedValue(makeMember({ hasPhoto: true }));
    mocks.getMemberPhoto.mockResolvedValue(stored);
    render();
    await screen.findByText('Only an Admin can replace an existing photo.');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('a failed photo fetch shows a message with Retry, and the rest of the profile still works', async () => {
    mocks.getMember.mockResolvedValue(makeMember({ hasPhoto: true }));
    mocks.getMemberPhoto.mockRejectedValueOnce(new AppError('NETWORK')).mockResolvedValue(stored);
    render();
    expect(await screen.findByText(/The photo could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rahul Sharma' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/The photo could not be loaded/)).not.toBeInTheDocument());
  });
});
