import { type Role } from './roles';
import { ROUTES } from './routes';

export type NavIconKey =
  | 'dashboard'
  | 'members'
  | 'plans'
  | 'payments'
  | 'attendance'
  | 'trainers'
  | 'reports'
  | 'settings';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  iconKey: NavIconKey;
  /** Roles allowed to see the item AND to enter the route (same constant feeds the guard). */
  allow: readonly Role[];
  /** Phase in which the real screen ships (1 = the placeholder shell). */
  phase: number;
}

/** Sidebar items, in display order (FR-17). */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: ROUTES.dashboard, iconKey: 'dashboard', allow: ['ADMIN'], phase: 2 },
  { key: 'members', label: 'Members', path: ROUTES.members, iconKey: 'members', allow: ['ADMIN', 'STAFF'], phase: 2 },
  { key: 'plans', label: 'Membership Plans', path: ROUTES.plans, iconKey: 'plans', allow: ['ADMIN', 'STAFF'], phase: 3 },
  { key: 'payments', label: 'Payments', path: ROUTES.payments, iconKey: 'payments', allow: ['ADMIN'], phase: 4 },
  { key: 'attendance', label: 'Attendance', path: ROUTES.attendance, iconKey: 'attendance', allow: ['ADMIN', 'STAFF'], phase: 5 },
  { key: 'trainers', label: 'Trainers', path: ROUTES.trainers, iconKey: 'trainers', allow: ['ADMIN', 'STAFF'], phase: 2 },
  { key: 'reports', label: 'Reports', path: ROUTES.reports, iconKey: 'reports', allow: ['ADMIN'], phase: 6 },
  { key: 'settings', label: 'Settings', path: ROUTES.settings, iconKey: 'settings', allow: ['ADMIN'], phase: 7 },
];

/** Routes that are not sidebar entries (architecture §7). Same `allow` mechanism as NAV_ITEMS. */
export interface ExtraRoute {
  path: string;
  allow: readonly Role[];
}

export const EXTRA_ROUTES: readonly ExtraRoute[] = [
  { path: ROUTES.memberNew, allow: ['ADMIN', 'STAFF'] },
  // static segments rank above /members/:memberDocId (architecture §7)
  { path: ROUTES.membersExpiring, allow: ['ADMIN', 'STAFF'] },
  { path: ROUTES.membersExpired, allow: ['ADMIN', 'STAFF'] },
  { path: '/members/:memberDocId', allow: ['ADMIN', 'STAFF'] },
  { path: '/members/:memberDocId/edit', allow: ['ADMIN'] },
  // Payments is Admin only (matrix): the pending list is a sub-page of the Payments menu entry (architecture §7)
  { path: ROUTES.paymentsPending, allow: ['ADMIN'] },
  // Attendance: Admin and Staff (matrix: Staff may mark attendance and see today's list / history / the monthly report)
  { path: ROUTES.attendanceMonthly, allow: ['ADMIN', 'STAFF'] },
];

/** Everything the post-login return check may match: sidebar routes plus the nested member routes. */
export const ROUTE_ACCESS: readonly { path: string; allow: readonly Role[] }[] = [...NAV_ITEMS, ...EXTRA_ROUTES];

export function navItemsForRole(role: Role | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.allow.includes(role));
}
