import { ThemeProvider } from '@mui/material';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { AppError } from '../services/errors';
import { theme } from '../theme';
import { type AppUser } from '../types';
import { AppRoutes } from './AppRoutes';

const mocks = vi.hoisted(() => ({
  emit: null as null | ((user: AppUser | null) => void),
  signIn: vi.fn(),
  signOutUser: vi.fn(),
  sendReset: vi.fn(),
  getUserDoc: vi.fn(),
  measureClockSkewMs: vi.fn(),
}));

vi.mock('../services/clockSkewService', () => ({ measureClockSkewMs: mocks.measureClockSkewMs }));
vi.mock('../services/authService', () => ({
  observeAuth: (cb: (user: AppUser | null) => void) => {
    mocks.emit = cb;
    return () => undefined;
  },
  signIn: mocks.signIn,
  signOutUser: mocks.signOutUser,
  sendReset: mocks.sendReset,
}));
vi.mock('../services/userService', () => ({ getUserDoc: mocks.getUserDoc }));
// The Phase 2 pages load data through these services; stub them so route tests never touch Firebase.
vi.mock('../services/memberService', () => ({
  listMembers: vi.fn(async () => ({ items: [], next: null })),
  listExpiringMembers: vi.fn(async () => ({ items: [], next: null })),
  listExpiredMembers: vi.fn(async () => ({ items: [], next: null })),
  getMember: vi.fn(async () => null),
  generateMemberDocId: () => 'new-doc-id',
  findMemberByMobile: vi.fn(async () => null),
  registerMember: vi.fn(),
  updateMember: vi.fn(),
  softDeleteMember: vi.fn(),
}));
vi.mock('../services/trainerService', () => ({
  listTrainers: vi.fn(async () => []),
  createTrainer: vi.fn(),
  updateTrainer: vi.fn(),
  deleteTrainer: vi.fn(),
}));
vi.mock('../services/planService', () => ({
  listPlans: vi.fn(async () => []),
  generatePlanDocId: () => 'new-plan-id',
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
}));
vi.mock('../services/membershipService', () => ({
  listMemberships: vi.fn(async () => ({ items: [], next: null })),
  generateMembershipDocId: () => 'new-membership-id',
  assignMembership: vi.fn(),
  renewMembership: vi.fn(),
  setSuspended: vi.fn(),
}));
vi.mock('../services/paymentService', () => ({
  listPayments: vi.fn(async () => ({ items: [], next: null })),
  listPendingMembers: vi.fn(async () => ({ items: [], next: null })),
  getPendingPaymentTotals: vi.fn(async () => ({ totalPaise: 0, memberCount: 0 })),
  listMemberPayments: vi.fn(async () => ({ items: [], next: null })),
  listUnpaidMemberships: vi.fn(async () => []),
  generatePaymentDocId: () => 'new-payment-id',
  recordPayment: vi.fn(),
  voidPayment: vi.fn(),
}));
vi.mock('../services/attendanceService', () => ({
  listTodayAttendance: vi.fn(async () => ({ items: [], next: null })),
  listMemberAttendance: vi.fn(async () => ({ items: [], next: null })),
  getTodayAttendanceCounts: vi.fn(async () => ({ todayPresent: 0, currentlyCheckedIn: 0 })),
  getMonthlyDayCounts: vi.fn(async () => []),
  getMemberMonthPresentCounts: vi.fn(async () => ({})),
  getTodayAttendance: vi.fn(async () => null),
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  markAbsent: vi.fn(),
}));
vi.mock('../services/reportService', () => ({
  listReportPage: vi.fn(async () => ({ items: [], next: null })),
  getReportTotals: vi.fn(async () => ({ kind: 'count', count: 0 })),
  exportReport: vi.fn(),
  ExportCancelledError: class ExportCancelledError extends Error {},
}));
vi.mock('../services/dashboardService', () => ({
  getAttendanceDashboardStats: vi.fn(async () => ({ todayPresent: 0, currentlyCheckedIn: 0, byMonth: [] })),
  getPaymentDashboardStats: vi.fn(async () => ({
    pending: { totalPaise: 0, memberCount: 0 },
    revenueByMonth: [],
    currentMonthPaise: 0,
  })),
  getDashboardStats: vi.fn(async () => ({
    totalMembers: 0,
    newMembersByMonth: [],
    statusCounts: { total: 0, active: 0, expiringSoon: 0, expired: 0, suspended: 0, noMembership: 0 },
    planDistribution: [],
    nextExpiring: [],
  })),
}));
vi.mock('../services/memberPhotoService', () => ({ getMemberPhoto: vi.fn(async () => null), saveMemberPhoto: vi.fn(), removeMemberPhoto: vi.fn() }));
vi.mock('../services/memberMedicalService', () => ({ getMemberMedical: vi.fn(async () => null) }));
vi.mock('../components/dashboard/NewMembersChart', () => ({ default: () => <div data-testid="chart" /> }));
vi.mock('../components/dashboard/RevenueChart', () => ({ default: () => <div data-testid="revenue-chart" /> }));

const admin: AppUser = { uid: 'a1', email: 'owner@example.com', displayName: 'Gym Owner' };

function renderApp(initialPath: string) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function emit(user: AppUser | null) {
  await act(async () => {
    mocks.emit?.(user);
  });
}

beforeEach(() => {
  // dev-only login-refusal diagnostics (utils/devDiagnostics) would otherwise print in every refusal test
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.emit = null;
  mocks.signIn.mockReset();
  mocks.sendReset.mockReset();
  mocks.getUserDoc.mockReset();
  mocks.measureClockSkewMs.mockReset();
  mocks.measureClockSkewMs.mockResolvedValue(0); // a correct clock: no banner
  mocks.signOutUser.mockReset();
  mocks.signOutUser.mockImplementation(async () => {
    mocks.emit?.(null);
  });
});

describe('signed out', () => {
  it('shows a loader (not the login page) until the session is known (US-1.2a)', () => {
    renderApp('/members');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('redirects a protected URL to login and fetches no role data (US-1.5a)', async () => {
    renderApp('/members');
    await emit(null);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(mocks.getUserDoc).not.toHaveBeenCalled();
  });

  it('an unknown URL while signed out redirects to login, not a 404, and fetches no role data (US-1.5c)', async () => {
    renderApp('/does-not-exist');
    await emit(null);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
    expect(mocks.getUserDoc).not.toHaveBeenCalled();
  });

  it('disables submit while the request is in flight and never double-submits (US-1.1f)', async () => {
    let finish: (e: Error) => void = () => undefined;
    mocks.signIn.mockReturnValue(new Promise<void>((_resolve, reject) => (finish = reject)));
    renderApp('/login');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass{Enter}');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    await waitFor(() => expect(submit).toBeDisabled());
    expect(mocks.signIn).toHaveBeenCalledTimes(1);

    fireEvent.click(submit); // a disabled button ignores clicks (userEvent refuses: pointer-events none)
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}'); // nor does Enter in a field
    expect(mocks.signIn).toHaveBeenCalledTimes(1);

    await act(async () => finish(new AppError('INVALID_CREDENTIALS')));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('a disabled account gets the same generic login message as a wrong password (L3)', async () => {
    mocks.signIn.mockRejectedValue(Object.assign(new Error('Firebase: user disabled'), { code: 'auth/user-disabled' }));
    renderApp('/login');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'disabled@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.queryByText(/disabled|permission/i)).not.toBeInTheDocument();
  });

  it('login form validates without any network call (US-1.1c)', async () => {
    renderApp('/login');
    await emit(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('shows one generic message for bad credentials and keeps the form filled (US-1.1b/e)', async () => {
    mocks.signIn.mockRejectedValue(new AppError('INVALID_CREDENTIALS'));
    renderApp('/login');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('owner@example.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('forgot password shows the same generic confirmation even for an unknown account (US-1.4a)', async () => {
    mocks.sendReset.mockRejectedValue(new AppError('INVALID_CREDENTIALS'));
    renderApp('/forgot-password');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  });

  it('forgot password treats a raw auth/user-not-found like any unknown account: generic confirmation', async () => {
    mocks.sendReset.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/user-not-found' }));
    renderApp('/forgot-password');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  });

  it('forgot password does NOT show the confirmation for an UNKNOWN error; it shows the error with retry (L3)', async () => {
    mocks.sendReset.mockRejectedValueOnce(new Error('something unexpected'));
    renderApp('/forgot-password');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/If an account exists/)).not.toBeInTheDocument();

    mocks.sendReset.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('forgot password surfaces a network failure with retry (US-1.4c)', async () => {
    mocks.sendReset.mockRejectedValueOnce(new AppError('NETWORK'));
    renderApp('/forgot-password');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
    mocks.sendReset.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  });

  it('forgot password blocks an invalid email (US-1.4b)', async () => {
    renderApp('/forgot-password');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(mocks.sendReset).not.toHaveBeenCalled();
  });
});

describe('signed in as ADMIN', () => {
  beforeEach(() => {
    mocks.getUserDoc.mockResolvedValue({ role: 'ADMIN', active: true, email: admin.email, displayName: 'Gym Owner' });
  });

  it('shows no clock warning when the device clock is right, and a persistent warning when it is more than 5 minutes off (R-3)', async () => {
    renderApp('/dashboard');
    await emit(admin);
    await screen.findAllByRole('navigation', { name: 'Main navigation' });
    expect(screen.queryByText(/clock is/i)).not.toBeInTheDocument();
    expect(mocks.measureClockSkewMs).toHaveBeenCalledTimes(1);
  });

  it('a device clock 2 hours ahead raises the warning banner in the shell', async () => {
    mocks.measureClockSkewMs.mockResolvedValue(2 * 60 * 60_000);
    renderApp('/dashboard');
    await emit(admin);
    expect(await screen.findByRole('alert')).toHaveTextContent(/clock is about 2 hours ahead/i);
  });

  it('lands in the shell with all 8 sidebar entries, user name and role (US-1.7a)', async () => {
    renderApp('/dashboard');
    await emit(admin);
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]!;
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual([
      'Dashboard',
      'Members',
      'Membership Plans',
      'Payments',
      'Attendance',
      'Trainers',
      'Reports',
      'Settings',
    ]);
    expect(screen.getByText('Gym Owner')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it.each([
    ['/members', 'Members'],
    ['/members/new', 'Register member'],
    ['/members/expiring', 'Expiring soon'],
    ['/members/expired', 'Expired members'],
    ['/plans', 'Membership Plans'],
    ['/payments', 'Payments'],
    ['/payments/pending', 'Pending payments'],
    ['/attendance', 'Attendance'],
    ['/attendance/monthly', 'Monthly attendance'],
    ['/trainers', 'Trainers'],
    ['/dashboard', 'Dashboard'],
    ['/reports', 'Reports'],
    ['/settings', 'Settings'],
  ])('%s renders its real screen (Phase 2 to 7), not the placeholder', async (path, title) => {
    renderApp(path);
    await emit(admin);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByText('Coming in a later phase')).not.toBeInTheDocument();
  });

  it('/members/new is the register screen, not a member profile with the id "new"', async () => {
    renderApp('/members/new');
    await emit(admin);
    expect(await screen.findByRole('form', { name: 'Register member' })).toBeInTheDocument();
  });

  it('an unknown member id shows "Member not found" (US-2.9c)', async () => {
    renderApp('/members/does-not-exist');
    await emit(admin);
    expect(await screen.findByText('Member not found')).toBeInTheDocument();
  });

  it('redirects / to the dashboard', async () => {
    renderApp('/');
    await emit(admin);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown URL', async () => {
    renderApp('/does-not-exist');
    await emit(admin);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('after login returns to the originally requested page (US-1.5b)', async () => {
    mocks.signIn.mockImplementation(async () => {
      mocks.emit?.(admin);
    });
    renderApp('/members');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
  });

  it('after login goes to the dashboard when the requested URL is not a known route (US-1.5b)', async () => {
    mocks.signIn.mockImplementation(async () => {
      mocks.emit?.(admin);
    });
    renderApp('/members/some-id/does-not-exist');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });

  it('after login goes to the dashboard when ?next= is an open-redirect attempt', async () => {
    mocks.signIn.mockImplementation(async () => {
      mocks.emit?.(admin);
    });
    renderApp('/login?next=%2F%2Fevil.example');
    await emit(null);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('logout returns to the login page and protected content is gone (US-1.3)', async () => {
    renderApp('/dashboard');
    await emit(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});

describe('refused accounts', () => {
  it('a user without a users doc sees the refusal message and is signed out (US-1.6b)', async () => {
    mocks.getUserDoc.mockResolvedValue(null);
    renderApp('/dashboard');
    await emit(admin);
    expect(await screen.findByText('You do not have access to this application')).toBeInTheDocument();
    expect(mocks.signOutUser).toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });

  it('STAFF is refused in Phase 1', async () => {
    mocks.getUserDoc.mockResolvedValue({ role: 'STAFF', active: true, email: 's@example.com', displayName: 'S' });
    renderApp('/dashboard');
    await emit(admin);
    expect(await screen.findByText('You do not have access to this application')).toBeInTheDocument();
  });

  it('a network error while loading the role shows a retryable error and no protected UI (US-1.6c)', async () => {
    mocks.getUserDoc.mockRejectedValueOnce(new AppError('NETWORK'));
    renderApp('/dashboard');
    await emit(admin);
    expect(await screen.findByText('Could not verify your access')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    mocks.getUserDoc.mockResolvedValueOnce({ role: 'ADMIN', active: true, email: 'a', displayName: 'A' });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
  });
});
