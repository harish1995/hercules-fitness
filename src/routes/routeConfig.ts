import { type ComponentType } from 'react';
import { EXTRA_ROUTES, NAV_ITEMS } from '../constants/navigation';
import { type Role } from '../constants/roles';
import { ROUTES } from '../constants/routes';
import { AttendancePage } from '../pages/attendance/AttendancePage';
import { MonthlyAttendancePage } from '../pages/attendance/MonthlyAttendancePage';
import { DashboardPage } from '../pages/DashboardPage';
import { ExpiredMembersPage } from '../pages/members/ExpiredMembersPage';
import { ExpiringMembersPage } from '../pages/members/ExpiringMembersPage';
import { MemberEditPage } from '../pages/members/MemberEditPage';
import { MemberProfilePage } from '../pages/members/MemberProfilePage';
import { MemberRegisterPage } from '../pages/members/MemberRegisterPage';
import { MembersListPage } from '../pages/members/MembersListPage';
import { PaymentsPage } from '../pages/payments/PaymentsPage';
import { PendingPaymentsPage } from '../pages/payments/PendingPaymentsPage';
import { PlansPage } from '../pages/plans/PlansPage';
import { ReportsPage } from '../pages/reports/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TrainersPage } from '../pages/trainers/TrainersPage';
import { placeholderFor } from './placeholders';

export interface AppRouteDef {
  path: string;
  allow: readonly Role[];
  Component: ComponentType;
}

/** Real screens shipped so far. Everything else in NAV_ITEMS gets a placeholder. */
const BUILT_PAGES: Readonly<Record<string, ComponentType>> = {
  [ROUTES.dashboard]: DashboardPage,
  [ROUTES.settings]: SettingsPage,
  [ROUTES.members]: MembersListPage,
  [ROUTES.trainers]: TrainersPage,
  [ROUTES.plans]: PlansPage,
  [ROUTES.payments]: PaymentsPage,
  [ROUTES.attendance]: AttendancePage,
  [ROUTES.reports]: ReportsPage,
};

/** Non-sidebar screens (their `allow` lives in EXTRA_ROUTES so the post-login check shares it). */
const EXTRA_PAGES: Readonly<Record<string, ComponentType>> = {
  [ROUTES.memberNew]: MemberRegisterPage,
  [ROUTES.membersExpiring]: ExpiringMembersPage,
  [ROUTES.membersExpired]: ExpiredMembersPage,
  '/members/:memberDocId': MemberProfilePage,
  '/members/:memberDocId/edit': MemberEditPage,
  [ROUTES.paymentsPending]: PendingPaymentsPage,
  [ROUTES.attendanceMonthly]: MonthlyAttendancePage,
};

/**
 * One route per sidebar item. `allow` comes from the same NAV_ITEMS constant that drives the
 * sidebar, so a hidden menu item is also blocked by the guard.
 */
export const APP_ROUTES: readonly AppRouteDef[] = [
  ...NAV_ITEMS.map((item) => ({
    path: item.path,
    allow: item.allow,
    Component: BUILT_PAGES[item.path] ?? placeholderFor(item.label),
  })),
  // React Router ranks the static /members/new above /members/:memberDocId.
  ...EXTRA_ROUTES.map((r) => ({ path: r.path, allow: r.allow, Component: EXTRA_PAGES[r.path] ?? placeholderFor(r.path) })),
];
