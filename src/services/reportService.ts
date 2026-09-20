import { db } from '../firebase/app';
import { type Page, type PageCursor } from '../types/member';
import { type ExportedReport, type ReportRecord, type ReportSpec, type ReportTotals } from '../types/report';
import { exportReportFor, type ExportRequest } from './reportExport';
import { getReportTotalsFor, listReportPageFor } from './reportQueries';

/** App-facing report API (table pages, totals, CSV export), bound to the app's Firestore instance. Admin-only screens call it. */

export { ExportCancelledError } from './reportExport';

export const listReportPage = (spec: ReportSpec, cursor: PageCursor | null = null): Promise<Page<ReportRecord>> =>
  listReportPageFor(db, spec, cursor);

export const getReportTotals = (spec: ReportSpec): Promise<ReportTotals> => getReportTotalsFor(db, spec);

export const exportReport = (req: ExportRequest): Promise<ExportedReport> => exportReportFor(db, req);
