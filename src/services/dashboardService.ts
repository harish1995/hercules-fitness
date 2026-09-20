import { type Clock } from '../domain/dates';
import { db } from '../firebase/app';
import { type AttendanceDashboardStats } from '../types/attendance';
import { type DashboardStats } from '../types/member';
import { type PaymentDashboardStats } from '../types/payment';
import { getAttendanceDashboardStatsFor } from './attendanceQueries';
import { getDashboardStatsFor } from './memberQueries';
import { getPaymentDashboardStatsFor } from './paymentQueries';

/** Member figures for the dashboard: status cards, plan chart, next expiring, new members per month (US-2.12, US-3.12). */
export function getDashboardStats(clock?: Clock): Promise<DashboardStats> {
  return getDashboardStatsFor(db, clock);
}

/**
 * Money figures for the dashboard (US-4.5c, US-4.6): pending total + members owing, and revenue per IST month. Loaded
 * separately from the member figures so a problem with one (e.g. an index still building) never blanks the other.
 */
export function getPaymentDashboardStats(clock?: Clock): Promise<PaymentDashboardStats> {
  return getPaymentDashboardStatsFor(db, clock);
}

/**
 * Attendance figures for the dashboard (US-5.7): today's PRESENT count, the currently-checked-in count and PRESENT per IST month,
 * all `count()` aggregations. Loaded separately so a problem with one set (e.g. an index still building) never blanks the others.
 */
export function getAttendanceDashboardStats(clock?: Clock): Promise<AttendanceDashboardStats> {
  return getAttendanceDashboardStatsFor(db, clock);
}
