import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage, makeMember } from '../../test/render';
import { AppError } from '../../services/errors';
import { type Member, type Page, type PageCursor } from '../../types/member';
import { MembersListPage } from './MembersListPage';

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  softDeleteMember: vi.fn(),
  actor: { uid: 'u1', name: 'Owner', role: 'ADMIN' } as { uid: string; name: string; role: string } | null,
}));
vi.mock('../../services/memberService', () => ({ listMembers: mocks.listMembers, softDeleteMember: mocks.softDeleteMember }));
vi.mock('../../services/planService', () => ({
  listPlans: vi.fn(async () => [
    { id: 'p1', name: 'Monthly', durationValue: 1, durationUnit: 'MONTHS', pricePaise: 150000, description: null, active: true, createdAt: new Date(), updatedAt: new Date() },
  ]),
}));
vi.mock('../../services/attendanceService', () => ({
  getTodayAttendance: vi.fn(async () => null), checkIn: vi.fn(), checkOut: vi.fn(), markAbsent: vi.fn(),
}));
vi.mock('../../services/membershipService', () => ({
  generateMembershipDocId: () => 'm-new', assignMembership: vi.fn(), renewMembership: vi.fn(), setSuspended: vi.fn(),
}));
vi.mock('../../hooks/useActor', () => ({ useActor: () => mocks.actor }));

/** the browse query the page issues (today is the IST day start, so match loosely) */
const browse = (over: Record<string, unknown> = {}) =>
  expect.objectContaining({ mode: 'browse', status: 'ALL', planId: null, expiryFrom: null, expiryTo: null, sort: 'REGISTERED', ...over });

const cursor = (n: number) => ({ n }) as unknown as PageCursor;
const page = (items: Member[], next: PageCursor | null = null): Page<Member> => ({ items, next });
const people = (n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => makeMember({ id: `d${start + i}`, memberId: `GYM-2026-${String(start + i + 1).padStart(4, '0')}`, displayName: `Person ${start + i}`, firstName: `Person${start + i}` }));

beforeEach(() => {
  mocks.listMembers.mockReset();
  mocks.softDeleteMember.mockReset();
  mocks.actor = { uid: 'u1', name: 'Owner', role: 'ADMIN' };
});

const render = () => renderPage(<MembersListPage />, { path: '/members', url: '/members' });

describe('MembersListPage: list, states and paging (US-2.8)', () => {
  it('shows a loading state, then the first page (browse mode, no cursor)', async () => {
    mocks.listMembers.mockResolvedValue(page(people(3)));
    render();
    expect(screen.getByRole('status')).toHaveTextContent('Loading members…');
    expect(await screen.findByText('Person 0')).toBeInTheDocument();
    expect(mocks.listMembers).toHaveBeenCalledWith(browse(), null);
    expect(screen.getByText('GYM-2026-0001')).toBeInTheDocument();
    expect(screen.getAllByText('No membership')).toHaveLength(3);
  });

  it('empty collection: "No members yet" with a register action; no matches: a different message', async () => {
    mocks.listMembers.mockResolvedValue(page([]));
    render();
    expect(await screen.findByText('No members yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search members'), 'zzz');
    expect(await screen.findByText('No members found')).toBeInTheDocument();
  });

  it('a failed load shows a friendly error with retry (US-2.8d)', async () => {
    mocks.listMembers.mockRejectedValueOnce(new AppError('NETWORK')).mockResolvedValue(page(people(1)));
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Person 0')).toBeInTheDocument();
  });

  it('Next passes the cursor the previous page returned; Previous goes back through the stack', async () => {
    mocks.listMembers.mockImplementation(async (_q: unknown, c: { n: number } | null) =>
      c === null ? page(people(2, 0), cursor(1)) : page(people(2, 2), null),
    );
    render();
    expect(await screen.findByText('Person 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Person 2')).toBeInTheDocument();
    expect(mocks.listMembers).toHaveBeenLastCalledWith(browse(), { n: 1 });
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled(); // last page
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Person 0')).toBeInTheDocument();
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
  });
});

describe('MembersListPage: search and the supported combinations (architecture §5.3)', () => {
  it('debounces typing (300 ms) and infers the search field from the input', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    mocks.listMembers.mockClear();
    await userEvent.type(screen.getByLabelText('Search members'), '98765');
    expect(mocks.listMembers).not.toHaveBeenCalled(); // still inside the debounce window
    await waitFor(() => expect(mocks.listMembers).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mocks.listMembers).toHaveBeenCalledWith({ mode: 'search', kind: 'mobile', term: '98765' }, null);

    mocks.listMembers.mockClear();
    await userEvent.clear(screen.getByLabelText('Search members'));
    await userEvent.type(screen.getByLabelText('Search members'), 'gym-2026-00');
    await waitFor(() => expect(mocks.listMembers).toHaveBeenCalledWith({ mode: 'search', kind: 'memberId', term: 'GYM-2026-00' }, null), { timeout: 2000 });

    mocks.listMembers.mockClear();
    await userEvent.clear(screen.getByLabelText('Search members'));
    await userEvent.type(screen.getByLabelText('Search members'), 'Rah');
    await waitFor(() => expect(mocks.listMembers).toHaveBeenCalledWith({ mode: 'search', kind: 'name', term: 'rah' }, null), { timeout: 2000 });
  }, 20_000);

  it('states the prefix-only rule in the UI', async () => {
    mocks.listMembers.mockResolvedValue(page([]));
    render();
    expect(await screen.findByText(/Matches the start only/)).toBeInTheDocument();
  });

  it('while a search term is typed, status and sort are DISABLED with an explanation (never client-filtered)', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    expect(screen.getByRole('combobox', { name: 'Status' })).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Search members'), 'rah');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('Filters are unavailable while searching. Clear the search to filter.').length).toBeGreaterThan(0);
  });

  it('a server-side status filter re-queries with that filter (no client-side filtering); every status is enabled in Phase 3', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    const listbox = await screen.findByRole('listbox');
    for (const name of ['Active', 'Expiring soon', 'Expired', 'Suspended', 'No membership']) {
      expect(within(listbox).getByRole('option', { name })).not.toHaveAttribute('aria-disabled', 'true');
    }
    await userEvent.click(within(listbox).getByRole('option', { name: 'Suspended' }));
    await waitFor(() => expect(mocks.listMembers).toHaveBeenLastCalledWith(browse({ status: 'SUSPENDED' }), null));
  });

  it('a date status forces the expiry sort; without a date filter the expiry sorts are disabled (matrix rows 3, 9)', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort' }));
    let listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Expiry date \(soonest first\)/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Expiring soon' }));
    await waitFor(() => expect(mocks.listMembers).toHaveBeenLastCalledWith(browse({ status: 'EXPIRING_SOON', sort: 'EXPIRY_ASC' }), null));
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort' }));
    listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Registered/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(within(listbox).getByRole('option', { name: /Expiry date \(latest first\)/ }));
    await waitFor(() => expect(mocks.listMembers).toHaveBeenLastCalledWith(browse({ status: 'EXPIRING_SOON', sort: 'EXPIRY_DESC' }), null));
  });

  it('an expiry date range and a plan filter are passed to the server query', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    fireEvent.change(screen.getByLabelText('Expires from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Expires to'), { target: { value: '2026-10-31' } });
    await waitFor(() =>
      expect(mocks.listMembers).toHaveBeenLastCalledWith(
        browse({ expiryFrom: new Date('2026-10-01T00:00:00+05:30'), expiryTo: new Date('2026-10-31T00:00:00+05:30'), sort: 'EXPIRY_ASC' }),
        null,
      ),
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Monthly' }));
    await waitFor(() => expect(mocks.listMembers).toHaveBeenLastCalledWith(browse({ planId: 'p1', sort: 'EXPIRY_ASC', expiryFrom: expect.any(Date), expiryTo: expect.any(Date) }), null));
  });

  it('an expiry range that cannot overlap the status shows an empty state and issues no useful query', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Expired' }));
    mocks.listMembers.mockResolvedValue(page([])); // what the service returns for an empty intersection (planMemberQuery yields no plans)
    fireEvent.change(screen.getByLabelText('Expires from'), { target: { value: '2999-01-01' } }); // Expired means before today
    expect(await screen.findByText(/do not overlap/)).toBeInTheDocument();
  });

  it('the initial status can come from the URL (dashboard card links)', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    renderPage(<MembersListPage />, { path: '/members', url: '/members?status=EXPIRED' });
    await waitFor(() => expect(mocks.listMembers).toHaveBeenCalledWith(browse({ status: 'EXPIRED', sort: 'EXPIRY_ASC' }), null));
  });

  it('a stale slow response never overwrites a newer one (US-2.8e)', async () => {
    let releaseSlow: (p: Page<Member>) => void = () => undefined;
    mocks.listMembers.mockImplementation(async (q: { mode: string; term?: string }) => {
      if (q.mode === 'browse') return page(people(1));
      if (q.term === 'a') return new Promise<Page<Member>>((r) => (releaseSlow = r));
      return page([makeMember({ id: 'new', displayName: 'Fresh Result' })]);
    });
    render();
    await screen.findByText('Person 0');
    await userEvent.type(screen.getByLabelText('Search members'), 'a');
    await waitFor(() => expect(mocks.listMembers).toHaveBeenCalledWith({ mode: 'search', kind: 'name', term: 'a' }, null), { timeout: 2000 });
    await userEvent.type(screen.getByLabelText('Search members'), 'b');
    expect(await screen.findByText('Fresh Result', undefined, { timeout: 2000 })).toBeInTheDocument();
    releaseSlow(page([makeMember({ id: 'old', displayName: 'Stale Result' })]));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh Result')).toBeInTheDocument();
  });
});

describe('MembersListPage: actions and roles', () => {
  it('Admin can delete only through a confirm dialog; confirming soft-deletes and reloads (US-2.11)', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    mocks.softDeleteMember.mockResolvedValue(undefined);
    render();
    await screen.findByText('Person 0');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete Person 0?' })).toBeInTheDocument();
    expect(mocks.softDeleteMember).not.toHaveBeenCalled(); // nothing written before confirmation
    await userEvent.click(screen.getByRole('button', { name: 'Delete member' }));
    await waitFor(() => expect(mocks.softDeleteMember).toHaveBeenCalledWith({ memberDocId: 'd0', actor: mocks.actor }));
    await waitFor(() => expect(mocks.listMembers.mock.calls.length).toBeGreaterThan(1)); // reloaded
  });

  it('cancelling the confirm dialog deletes nothing', async () => {
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.softDeleteMember).not.toHaveBeenCalled();
  });

  it('Staff sees View and Attendance only: no Edit and no Delete', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    mocks.listMembers.mockResolvedValue(page(people(1)));
    render();
    await screen.findByText('Person 0');
    expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attendance' })).toBeInTheDocument(); // matrix: Staff may mark attendance
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    for (const name of ['Renew', 'Suspend', 'Reactivate']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('flags an Under 18 member and a suspended one in the list', async () => {
    const year = new Date().getFullYear() - 10;
    mocks.listMembers.mockResolvedValue(page([
      makeMember({ id: 'k', displayName: 'Kid', dateOfBirth: new Date(Date.UTC(year, 5, 15)) }),
      makeMember({ id: 's', displayName: 'Paused', suspended: true }),
    ]));
    render();
    await screen.findByText('Kid');
    expect(screen.getByText('Under 18')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });
});
