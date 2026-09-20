export const ROUTES = {
  login: '/login',
  forgotPassword: '/forgot-password',
  root: '/',
  dashboard: '/dashboard',
  members: '/members',
  memberNew: '/members/new',
  membersExpiring: '/members/expiring',
  membersExpired: '/members/expired',
  plans: '/plans',
  payments: '/payments',
  paymentsPending: '/payments/pending',
  attendance: '/attendance',
  attendanceMonthly: '/attendance/monthly',
  trainers: '/trainers',
  reports: '/reports',
  settings: '/settings',
} as const;

/** Query-string key used to remember where to return after login. */
export const NEXT_PARAM = 'next';

export const memberProfilePath = (memberDocId: string) => `/members/${memberDocId}`;
export const memberEditPath = (memberDocId: string) => `/members/${memberDocId}/edit`;
