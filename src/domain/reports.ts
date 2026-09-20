import { ATTENDANCE_STATUS_LABELS, GENDER_LABELS, PAYMENT_METHOD_LABELS } from '../constants/enums';
import { type AttendanceRecord } from '../types/attendance';
import { type Member } from '../types/member';
import { type Payment } from '../types/payment';
import { type ReportAttendanceStatus, type ReportId, type ReportRecord, type ReportSpec } from '../types/report';
import { type CsvCell } from './csv';
import { addIstDays, diffIstDays, formatIstDate, formatIstTime, istMonthRange, toCivilDate, toDayInputValue } from './dates';
import { formatRupeesPlain } from './money';
import { effectiveReportRange } from './reportQueryPlans';
import { calculateMembershipStatus, InvalidPeriodError, STATUS_LABELS } from './status';

/**
 * What each report shows and exports (architecture §5.7, FR-10, US-6.1, US-6.2). Pure and Firebase-free. The on-screen table
 * and the CSV use the SAME headers and the SAME row mapper, so the export has "the same filters and columns" (US-6.2a).
 *
 * Privacy (DPDP, FR-10, US-6.2e): each row is built ONLY from the fields named below. Medical notes are not even readable here
 * (they live in `memberMedical`, which no report reads); photos, consent internals, date of birth, address, emergency contact,
 * general notes and the suspension reason are never copied into a row; a payment's free-text notes and a voided payment's
 * reason are not exported (voided payments are not in the revenue report at all).
 */

/** Rows fetched per read while exporting (each read is one billed document per row). */
export const EXPORT_PAGE_SIZE = 250;
/** The most rows one export ever contains: an export is a paged read of at most this many documents (US-6.2d). */
export const EXPORT_MAX_ROWS = 5000;

export const REPORT_LABELS: Record<ReportId, string> = {
  MEMBERS: 'Members',
  EXPIRED: 'Expired memberships',
  EXPIRING: 'Expiring memberships',
  REVENUE: 'Revenue',
  ATTENDANCE: 'Attendance',
  PENDING: 'Pending payments',
};

/** Which date the filter applies to (US-6.1, NEW-20). */
export const REPORT_DATE_FILTERS: Record<ReportId, { from: string; to: string; help: string }> = {
  MEMBERS: { from: 'Joined from', to: 'Joined to', help: 'Members by joining date. Leave both empty for every member.' },
  EXPIRED: {
    from: 'Expired from',
    to: 'Expired to',
    help: 'Memberships that ended within the range (always before today), most recently expired first. Suspended members are not listed, like the Expired page.',
  },
  EXPIRING: {
    from: 'Expires from',
    to: 'Expires to',
    help: 'Memberships ending within the range (today or later), soonest first. Suspended members are not listed, like the Expiring soon page.',
  },
  REVENUE: {
    from: 'Paid from',
    to: 'Paid to',
    help: 'Payments received by payment date (cash basis). Voided payments are excluded from every figure and from the export.',
  },
  ATTENDANCE: { from: 'From', to: 'To', help: 'Attendance records by attendance date, oldest day first.' },
  PENDING: {
    from: 'Joined from',
    to: 'Joined to',
    help: 'Members who owe money, largest amount first, optionally only those who joined in the range. (This replaces the requirements\' "membership start date" filter, see the README.)',
  },
};

const MEMBER_ID = 'Member ID';
const NAME = 'Name';
const MOBILE = 'Mobile';
const PENDING = 'Amount pending (₹)';

const HEADERS: Record<ReportId, readonly string[]> = {
  MEMBERS: [MEMBER_ID, NAME, MOBILE, 'Email', 'Gender', 'Joining date', 'Plan', 'Membership start', 'Membership end', 'Status', PENDING],
  EXPIRED: [MEMBER_ID, NAME, MOBILE, 'Previous plan', 'Previous amount (₹)', 'Start date', 'Expiry date', 'Days since expiry', PENDING],
  EXPIRING: [MEMBER_ID, NAME, MOBILE, 'Plan', 'Expiry date', 'Days remaining', PENDING],
  REVENUE: ['Payment date', MEMBER_ID, NAME, 'Payment mode', 'Transaction reference', 'Amount (₹)'],
  ATTENDANCE: ['Date', MEMBER_ID, NAME, 'Status', 'Check-in', 'Check-out'],
  PENDING: [MEMBER_ID, NAME, MOBILE, 'Status', 'Expiry date', 'Joining date', PENDING],
};

export function reportHeaders(report: ReportId): readonly string[] {
  return HEADERS[report];
}

/** A column holding money or a count is right-aligned on screen. */
export const isNumericHeader = (header: string): boolean => header.endsWith('(₹)') || header.startsWith('Days ');

const day = (d: Date | null): string => (d ? formatIstDate(d) : '');
const rupees = (paise: number | null): string => (paise === null ? '' : formatRupeesPlain(paise));

function statusLabel(m: Member, today: Date): string {
  try {
    const { status } = calculateMembershipStatus(m.membership.startDate, m.membership.endDate, { suspended: m.suspended, clock: () => today });
    return STATUS_LABELS[status];
  } catch (e) {
    if (e instanceof InvalidPeriodError) return 'Check dates'; // corrupt dates are flagged, never silently computed (US-3.4e)
    throw e;
  }
}

function memberRow(report: 'MEMBERS' | 'EXPIRED' | 'EXPIRING' | 'PENDING', m: Member, today: Date): CsvCell[] {
  const { planName, startDate, endDate, amountPaise } = m.membership;
  switch (report) {
    case 'MEMBERS':
      return [m.memberId, m.displayName, m.mobile, m.email ?? '', GENDER_LABELS[m.gender], day(m.joiningDate), planName ?? '', day(startDate), day(endDate), statusLabel(m, today), rupees(m.pendingPaise)];
    case 'EXPIRED':
      return [m.memberId, m.displayName, m.mobile, planName ?? '', rupees(amountPaise), day(startDate), day(endDate), endDate ? diffIstDays(endDate, today) : '', rupees(m.pendingPaise)];
    case 'EXPIRING':
      return [m.memberId, m.displayName, m.mobile, planName ?? '', day(endDate), endDate ? diffIstDays(today, endDate) : '', rupees(m.pendingPaise)];
    case 'PENDING':
      return [m.memberId, m.displayName, m.mobile, statusLabel(m, today), day(endDate), day(m.joiningDate), rupees(m.pendingPaise)];
  }
}

const paymentRow = (p: Payment): CsvCell[] => [
  day(p.paymentDate),
  p.memberId,
  p.memberDisplayName,
  PAYMENT_METHOD_LABELS[p.method],
  p.transactionReference ?? '',
  rupees(p.amountPaise),
];

const attendanceRow = (a: AttendanceRecord): CsvCell[] => [
  day(a.date),
  a.memberId,
  a.memberName,
  ATTENDANCE_STATUS_LABELS[a.status],
  a.checkInAt ? formatIstTime(a.checkInAt) : '',
  // a PRESENT record without a check-out is "Not recorded" (NEW-13); an ABSENT one has no times at all
  a.status === 'PRESENT' && !a.checkedOut ? 'Not recorded' : a.checkOutAt ? formatIstTime(a.checkOutAt) : '',
];

/** One report row as display / CSV values (money = plain rupees with 2 decimals, dates DD/MM/YYYY IST). */
export function reportRow(spec: Pick<ReportSpec, 'report' | 'today'>, record: ReportRecord): CsvCell[] {
  switch (spec.report) {
    case 'REVENUE':
      if (record.kind === 'payment') return paymentRow(record.payment);
      break;
    case 'ATTENDANCE':
      if (record.kind === 'attendance') return attendanceRow(record.record);
      break;
    default:
      if (record.kind === 'member') return memberRow(spec.report, record.member, spec.today);
  }
  throw new Error(`A ${record.kind} record does not belong in the ${spec.report} report`);
}

/** `hercules-revenue-20260920.csv`, with `-first-5000-rows` when the cap truncated it (so a partial file never passes as complete). */
export function exportFileName(report: ReportId, exportedOn: Date, truncatedAt: number | null): string {
  const stamp = formatIstDate(exportedOn).split('/').reverse().join('');
  return `hercules-${report.toLowerCase()}-${stamp}${truncatedAt === null ? '' : `-first-${truncatedAt}-rows`}.csv`;
}

/**
 * The audit metadata of an export (NEW-20, FR-13): WHICH report, WHICH filters (the dates the query really used), how many
 * rows and whether the cap cut it short. Field names and filters only: no member name, mobile, amount or any personal value.
 */
export function exportAuditMetadata(spec: ReportSpec, rowCount: number, truncated: boolean): Record<string, string | number | boolean> {
  const range = effectiveReportRange(spec);
  const bounds = range === 'empty' ? { from: null, to: null } : range;
  return {
    report: spec.report,
    from: bounds.from ? formatIstDate(bounds.from) : 'any',
    to: bounds.to ? formatIstDate(bounds.to) : 'any',
    ...(spec.report === 'ATTENDANCE' ? { status: spec.status } : {}),
    rowCount,
    truncated,
    rowCap: EXPORT_MAX_ROWS,
  };
}

/** The filter inputs of a report as the form holds them (`YYYY-MM-DD`, '' = not set). */
export interface ReportFilterInputs {
  from: string;
  to: string;
  status: ReportAttendanceStatus;
}

/** Quick windows for the Expiring report (the same choices as the Expiring soon page, US-3.9). */
export const EXPIRING_WINDOW_DAYS = [1, 3, 7, 15, 30] as const;

/**
 * What a report shows before the user touches a filter. Revenue and Attendance start on the current IST month so the first
 * load is small and useful; Expiring starts on the same 7-day window as the Expiring soon page; the others start unfiltered.
 */
export function defaultReportFilters(report: ReportId, today: Date): ReportFilterInputs {
  const { year, month } = toCivilDate(today);
  const monthStart = toDayInputValue(istMonthRange(year, month).start);
  switch (report) {
    case 'REVENUE':
    case 'ATTENDANCE':
      return { from: monthStart, to: toDayInputValue(today), status: 'ALL' };
    case 'EXPIRING':
      return { from: toDayInputValue(today), to: toDayInputValue(addIstDays(today, 7)), status: 'ALL' };
    default:
      return { from: '', to: '', status: 'ALL' };
  }
}
