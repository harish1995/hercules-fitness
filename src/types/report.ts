import { type PaymentMethod } from '../constants/enums';
import { type AttendanceRecord } from './attendance';
import { type Member } from './member';
import { type Payment } from './payment';

/**
 * Report types (architecture §5.7, FR-10, US-6.1). Firebase-free: the services convert documents into the domain
 * objects below. Calendar-day filters are Dates at 00:00 IST (inclusive on both ends, US-6.1d), null = unbounded.
 */

export const REPORT_IDS = ['MEMBERS', 'EXPIRED', 'EXPIRING', 'REVENUE', 'ATTENDANCE', 'PENDING'] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export function isReportId(value: unknown): value is ReportId {
  return typeof value === 'string' && (REPORT_IDS as readonly string[]).includes(value);
}

/** Attendance report: all records of the range, or only PRESENT / ABSENT ones. */
export type ReportAttendanceStatus = 'ALL' | 'PRESENT' | 'ABSENT';

interface ReportBase {
  /** the date filter the user typed (what it applies to depends on the report, see `REPORT_DATE_FILTERS`) */
  from: Date | null;
  to: Date | null;
  /** 00:00 IST today: the anchor of the Expired / Expiring predicates and of the status and day-count columns */
  today: Date;
}

export type ReportSpec =
  | (ReportBase & { report: 'MEMBERS' | 'EXPIRED' | 'EXPIRING' | 'REVENUE' | 'PENDING' })
  | (ReportBase & { report: 'ATTENDANCE'; status: ReportAttendanceStatus });

/** One row of any report: the document behind it, converted at the service boundary. */
export type ReportRecord =
  | { kind: 'member'; member: Member }
  | { kind: 'payment'; payment: Payment }
  | { kind: 'attendance'; record: AttendanceRecord };

export interface RevenueBucket {
  label: string;
  /** integer paise */
  totalPaise: number;
  count: number;
}

export interface RevenueSummary {
  /** every non-voided payment in the range */
  total: { totalPaise: number; count: number };
  byMethod: { method: PaymentMethod; totalPaise: number; count: number }[];
  /** per day (a range of up to 31 days) or per IST month; null when both dates are not set or the range is too long to bucket */
  breakdown: { granularity: 'DAY' | 'MONTH'; rows: RevenueBucket[] } | null;
}

/** The figures shown above a report's table (aggregations only, never a collection read). */
export type ReportTotals =
  | { kind: 'count'; count: number }
  | { kind: 'pending'; totalPaise: number; memberCount: number }
  | { kind: 'attendance'; present: number; absent: number }
  | ({ kind: 'revenue' } & RevenueSummary);

export interface ExportedReport {
  fileName: string;
  /** the CSV text in pieces (BOM first), ready for a Blob */
  chunks: string[];
  rowCount: number;
  /** true when the row cap cut the export short: more rows matched than were exported */
  truncated: boolean;
}
