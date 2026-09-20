import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../services/errors';
import { renderPage } from '../test/render';
import { DashboardPage } from './DashboardPage';

const mocks = vi.hoisted(() => ({ getDashboardStats: vi.fn(), getPaymentDashboardStats: vi.fn(), getAttendanceDashboardStats: vi.fn() }));
vi.mock('../services/dashboardService', () => ({
  getDashboardStats: mocks.getDashboardStats,
  getPaymentDashboardStats: mocks.getPaymentDashboardStats,
  getAttendanceDashboardStats: mocks.getAttendanceDashboardStats,
}));
vi.mock('../components/dashboard/AttendanceChart', () => ({
  default: ({ months }: { months: { label: string; count: number }[] }) => (
    <div data-testid="attendance-chart">{months.map((m) => `${m.label}:${m.count}`).join(',')}</div>
  ),
}));
vi.mock('../components/dashboard/RevenueChart', () => ({
  default: ({ months }: { months: { label: string; totalPaise: number }[] }) => (
    <div data-testid="revenue-chart">{months.map((m) => `${m.label}:${m.totalPaise}`).join(',')}</div>
  ),
}));
vi.mock('../components/dashboard/PlanDistributionChart', () => ({
  default: ({ entries }: { entries: { planName: string; count: number }[] }) => (
    <div data-testid="plan-chart">{entries.map((e) => `${e.planName}:${e.count}`).join(',')}</div>
  ),
}));
vi.mock('../components/dashboard/NewMembersChart', () => ({
  default: ({ months }: { months: { label: string; count: number }[] }) => (
    <div data-testid="chart">{months.map((m) => `${m.label}:${m.count}`).join(',')}</div>
  ),
}));

const money = {
  pending: { totalPaise: 820000, memberCount: 7 },
  revenueByMonth: [
    { year: 2026, month: 8, label: 'Aug 2026', totalPaise: 400000 },
    { year: 2026, month: 9, label: 'Sep 2026', totalPaise: 590000 },
  ],
  currentMonthPaise: 590000,
};

beforeEach(() => {
  mocks.getDashboardStats.mockReset();
  mocks.getPaymentDashboardStats.mockReset();
  mocks.getPaymentDashboardStats.mockResolvedValue(money);
  mocks.getAttendanceDashboardStats.mockReset();
  mocks.getAttendanceDashboardStats.mockResolvedValue(attendance);
});

const attendance = {
  todayPresent: 14,
  currentlyCheckedIn: 6,
  byMonth: [{ year: 2026, month: 9, label: 'Sep 2026', count: 210 }],
};

const stats = {
  totalMembers: 42,
  newMembersByMonth: [{ year: 2026, month: 9, label: 'Sep 2026', count: 3 }],
  statusCounts: { total: 42, active: 20, expiringSoon: 5, expired: 9, suspended: 3, noMembership: 5 },
  planDistribution: [{ planId: 'p1', planName: 'Monthly', count: 25 }],
  nextExpiring: [],
};

describe('DashboardPage (US-2.12, US-3.12)', () => {
  it('shows Total members from the aggregation and the new-members chart', async () => {
    mocks.getDashboardStats.mockResolvedValue(stats);
    renderPage(<DashboardPage />);
    const total = screen.getByRole('region', { name: 'Total members' });
    expect(await within(total).findByText('42')).toBeInTheDocument();
    expect(await screen.findByTestId('chart')).toHaveTextContent('Sep 2026:3');
  });

  it('status cards show the aggregation counts and link to the matching filtered list (US-3.12a)', async () => {
    mocks.getDashboardStats.mockResolvedValue(stats);
    renderPage(<DashboardPage />);
    await screen.findByText('42');
    for (const [label, count, status] of [['Active', '20', 'ACTIVE'], ['Expiring ≤ 7 days', '5', 'EXPIRING_SOON'], ['Expired', '9', 'EXPIRED'], ['Suspended', '3', 'SUSPENDED'], ['No membership', '5', 'NO_MEMBERSHIP']] as const) {
      const card = screen.getByRole('region', { name: label });
      expect(within(card).getByText(count)).toBeInTheDocument();
      expect(within(card).getByRole('link', { name: 'View list' })).toHaveAttribute('href', `/members?status=${status}`);
    }
    expect(await screen.findByTestId('plan-chart')).toHaveTextContent('Monthly:25');
  });

  it("Today's attendance and Currently checked in come from the aggregations, with the 12-month attendance chart (US-5.7)", async () => {
    mocks.getDashboardStats.mockResolvedValue(stats);
    renderPage(<DashboardPage />);
    const todayCard = screen.getByRole('region', { name: "Today's attendance" });
    expect(await within(todayCard).findByText('14')).toBeInTheDocument();
    const inCard = screen.getByRole('region', { name: 'Currently checked in' });
    expect(await within(inCard).findByText('6')).toBeInTheDocument();
    expect(await screen.findByTestId('attendance-chart')).toHaveTextContent('Sep 2026:210');
  });

  it('Pending payments and Revenue this month come from the aggregations, in rupees, with the 12-month chart (US-4.5c, US-4.6)', async () => {
    mocks.getDashboardStats.mockResolvedValue(stats);
    renderPage(<DashboardPage />);
    const pending = screen.getByRole('region', { name: 'Pending payments' });
    expect(await within(pending).findByText('₹8,200.00')).toBeInTheDocument();
    expect(pending).toHaveTextContent('7 members owing');
    expect(within(pending).getByRole('link', { name: 'View list' })).toHaveAttribute('href', '/payments/pending');
    const revenue = screen.getByRole('region', { name: 'Revenue this month' });
    expect(await within(revenue).findByText('₹5,900.00')).toBeInTheDocument();
    expect(await screen.findByTestId('revenue-chart')).toHaveTextContent('Aug 2026:400000,Sep 2026:590000');
  });

  it('a money-figures failure does not blank the member cards and offers a retry', async () => {
    mocks.getDashboardStats.mockResolvedValue(stats);
    mocks.getPaymentDashboardStats.mockRejectedValueOnce(new AppError('INDEX_REQUIRED')).mockResolvedValue(money);
    renderPage(<DashboardPage />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    const revenue = screen.getByRole('region', { name: 'Revenue this month' });
    await userEvent.click(await within(revenue).findByRole('button', { name: 'Retry' }));
    expect(await within(revenue).findByText('₹5,900.00')).toBeInTheDocument();
  });

  it('a load failure shows an error state with retry (US-2.12d)', async () => {
    mocks.getDashboardStats.mockRejectedValueOnce(new AppError('NETWORK')).mockResolvedValue(stats);
    renderPage(<DashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('42')).toBeInTheDocument();
  });

  it('Refresh reloads the figures', async () => {
    mocks.getDashboardStats
      .mockResolvedValueOnce(stats)
      .mockResolvedValue({ ...stats, totalMembers: 43, statusCounts: { ...stats.statusCounts, total: 43 } });
    renderPage(<DashboardPage />);
    await screen.findByText('42');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('43')).toBeInTheDocument();
    expect(mocks.getDashboardStats).toHaveBeenCalledTimes(2);
  });
});
