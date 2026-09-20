import { describe, expect, it } from 'vitest';
import { makeMember } from '../test/render';
import { type AttendanceRecord } from '../types/attendance';
import { type Payment } from '../types/payment';
import { type ReportSpec } from '../types/report';
import { addIstDays, fromCivilDate } from './dates';
import { buildCsv } from './csv';
import { defaultReportFilters, EXPORT_MAX_ROWS, exportAuditMetadata, exportFileName, isNumericHeader, reportHeaders, reportRow } from './reports';

/** US-8.1 / US-6.2: report rows, the CSV file name, the export audit metadata and the privacy allow-list. */
const TODAY = fromCivilDate(2026, 9, 20);
const spec = (report: ReportSpec['report'], over: Partial<ReportSpec> = {}) => ({ report, from: null, to: null, today: TODAY, status: 'ALL', ...over }) as ReportSpec;

describe('rows are built only from the documented fields (DPDP, US-6.2e)', () => {
  const member = makeMember({
    generalNotes: 'has asthma, allergic to nuts',
    address: '12 MG Road, Pune',
    email: 'rahul@example.com',
    suspendedReason: 'medical leave',
    emergencyContact: { name: 'Mrs Sharma', mobile: '9123456780' },
    dateOfBirth: fromCivilDate(1995, 5, 10),
    hasMembership: true,
    pendingPaise: 100000,
    membership: { membershipId: 'ms1', planId: 'p1', planName: 'Monthly', startDate: fromCivilDate(2026, 9, 1), endDate: fromCivilDate(2026, 9, 27), amountPaise: 150000 },
  });

  it.each(['MEMBERS', 'EXPIRED', 'EXPIRING', 'PENDING'] as const)('%s never contains notes, address, date of birth, emergency contact or a suspension reason', (report) => {
    const csv = buildCsv(reportHeaders(report), [reportRow(spec(report), { kind: 'member', member })]);
    for (const secret of ['asthma', 'nuts', 'MG Road', 'Mrs Sharma', '9123456780', 'medical leave', '10/05/1995', '1995']) {
      expect(csv, `${report} leaked ${secret}`).not.toContain(secret);
    }
  });

  it('the Members row shows the id, name, mobile, dates as DD/MM/YYYY (IST), status and plain-rupee pending', () => {
    const row = reportRow(spec('MEMBERS'), { kind: 'member', member });
    expect(row).toEqual(['GYM-2026-0001', 'Rahul Sharma', '9876543210', 'rahul@example.com', 'Male', '15/01/2026', 'Monthly', '01/09/2026', '27/09/2026', 'Expiring soon', '1000.00']);
    expect(reportHeaders('MEMBERS')).toHaveLength(row.length);
  });

  it('Expired and Expiring rows count days on the IST day; Pending shows the status', () => {
    expect(reportRow(spec('EXPIRED'), { kind: 'member', member: { ...member, membership: { ...member.membership, endDate: addIstDays(TODAY, -3) } } })[7]).toBe(3);
    expect(reportRow(spec('EXPIRING'), { kind: 'member', member })[5]).toBe(7);
    expect(reportRow(spec('PENDING'), { kind: 'member', member })[3]).toBe('Expiring soon');
  });

  it('a suspended member reads "Suspended"; corrupt dates read "Check dates" instead of a computed status', () => {
    expect(reportRow(spec('MEMBERS'), { kind: 'member', member: { ...member, suspended: true } })[9]).toBe('Suspended');
    const corrupt = { ...member, membership: { ...member.membership, startDate: fromCivilDate(2026, 10, 1) } };
    expect(reportRow(spec('MEMBERS'), { kind: 'member', member: corrupt })[9]).toBe('Check dates');
  });

  it('a payment row has the reference but never the free-text notes or a void reason; amounts are plain rupees with 2 decimals', () => {
    const payment = {
      id: 'p1', memberDocId: 'm1', memberId: 'GYM-2026-0001', memberDisplayName: 'Rahul Sharma', membershipId: 'ms1', amountPaise: 150050,
      paymentDate: fromCivilDate(2026, 9, 2), method: 'UPI', transactionReference: 'UPI-1', notes: 'gave cash to trainer', voided: false, voidReason: null,
    } as Payment;
    const row = reportRow(spec('REVENUE'), { kind: 'payment', payment });
    expect(row).toEqual(['02/09/2026', 'GYM-2026-0001', 'Rahul Sharma', 'UPI', 'UPI-1', '1500.50']);
    expect(row.join()).not.toContain('trainer');
  });

  it('an attendance row: Present without a check-out reads "Not recorded", Absent has no times', () => {
    const base = {
      id: 'a', memberDocId: 'm1', memberId: 'GYM-2026-0001', memberName: 'Rahul Sharma', date: fromCivilDate(2026, 9, 19), dateKey: '20260919',
      checkInAt: new Date('2026-09-19T03:30:00Z'), checkOutAt: null, checkedOut: false, status: 'PRESENT',
    } as AttendanceRecord;
    expect(reportRow(spec('ATTENDANCE'), { kind: 'attendance', record: base })).toEqual(['19/09/2026', 'GYM-2026-0001', 'Rahul Sharma', 'Present', '09:00', 'Not recorded']);
    expect(reportRow(spec('ATTENDANCE'), { kind: 'attendance', record: { ...base, status: 'ABSENT', checkInAt: null } })).toEqual(['19/09/2026', 'GYM-2026-0001', 'Rahul Sharma', 'Absent', '', '']);
  });

  it('a record of the wrong kind for a report is a programming error, not a silent blank row', () => {
    expect(() => reportRow(spec('REVENUE'), { kind: 'member', member })).toThrow(/does not belong/);
  });

  it('hostile text in a name goes through the CSV encoder: neutralized in the file', () => {
    const csv = buildCsv(reportHeaders('MEMBERS'), [reportRow(spec('MEMBERS'), { kind: 'member', member: { ...member, displayName: '=HYPERLINK("http://evil.example")' } })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
  });
});

describe('export file name and audit metadata', () => {
  it('hercules-<report>-<yyyymmdd>.csv, with the row count when the cap cut it short', () => {
    expect(exportFileName('REVENUE', new Date('2026-09-20T06:00:00Z'), null)).toBe('hercules-revenue-20260920.csv');
    expect(exportFileName('MEMBERS', new Date('2026-09-20T06:00:00Z'), 5000)).toBe('hercules-members-20260920-first-5000-rows.csv');
    expect(exportFileName('MEMBERS', new Date('2026-09-20T18:30:00Z'), null)).toBe('hercules-members-20260921.csv'); // the IST date, not UTC
  });

  it('the audit record names the report, the dates, the count and the cap: no personal value', () => {
    const meta = exportAuditMetadata(spec('MEMBERS', { from: fromCivilDate(2026, 1, 1), to: fromCivilDate(2026, 9, 20) }), 12, false);
    expect(meta).toEqual({ report: 'MEMBERS', from: '01/01/2026', to: '20/09/2026', rowCount: 12, truncated: false, rowCap: EXPORT_MAX_ROWS });
    expect(exportAuditMetadata(spec('ATTENDANCE', { status: 'PRESENT' } as Partial<ReportSpec>), 3, true)).toMatchObject({ status: 'PRESENT', truncated: true, from: 'any', to: 'any' });
    expect(Object.keys(meta).sort()).toEqual(['from', 'report', 'rowCap', 'rowCount', 'to', 'truncated']);
  });

  it('an unbounded Expiring report is audited with the window it really used (today onward), not "any"', () => {
    const meta = exportAuditMetadata(spec('EXPIRING'), 1, false);
    expect(meta.from).toBe('20/09/2026');
    expect(meta.to).toBe('any');
  });
});

describe('defaults and headers', () => {
  it('Revenue and Attendance start on the current IST month, Expiring on today..+7, the rest unfiltered', () => {
    expect(defaultReportFilters('REVENUE', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-20', status: 'ALL' });
    expect(defaultReportFilters('ATTENDANCE', TODAY).from).toBe('2026-09-01');
    expect(defaultReportFilters('EXPIRING', TODAY)).toEqual({ from: '2026-09-20', to: '2026-09-27', status: 'ALL' });
    expect(defaultReportFilters('MEMBERS', TODAY)).toEqual({ from: '', to: '', status: 'ALL' });
  });

  it('money and day-count columns are numeric', () => {
    expect(isNumericHeader('Amount pending (₹)')).toBe(true);
    expect(isNumericHeader('Days remaining')).toBe(true);
    expect(isNumericHeader('Name')).toBe(false);
  });
});
