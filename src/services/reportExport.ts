import { collection, doc, setDoc, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { runCsvExport, ExportCancelledError, type ExportProgress } from '../domain/reportExport';
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE, exportAuditMetadata, exportFileName, REPORT_LABELS, reportHeaders, reportRow } from '../domain/reports';
import { planReport } from '../domain/reportQueryPlans';
import { type Actor } from '../types/member';
import { type ExportedReport, type ReportSpec } from '../types/report';
import { auditDocData } from './auditService';
import { AppError, mapFirebaseError } from './errors';
import { listReportPageFor } from './reportQueries';

/**
 * CSV export of a report (architecture §5.7, FR-10, NEW-20, US-6.2). Admin only (the rules also refuse the audit record of a
 * Staff user, so a modified client gets no export trail either).
 *
 *   1. read the rows page by page (`EXPORT_PAGE_SIZE` per read) up to `EXPORT_MAX_ROWS`, with progress and cancel;
 *   2. write the REPORT_EXPORTED audit record (who, which report, the filters, row count, truncated flag: no personal values);
 *   3. only then hand the CSV to the caller.
 * The audit write is a precondition, not a courtesy: if the export cannot be recorded, no file is released (bulk personal data
 * must leave the app with a trail). A cancel or ANY failure before the hand-off yields no file at all (US-6.2f).
 */

export { ExportCancelledError };

export interface ExportRequest {
  spec: ReportSpec;
  actor: Actor;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  /** injectable for tests */
  now?: () => Date;
  maxRows?: number;
  pageSize?: number;
}

/** The audit record of one export, written on its own (an export reads data, so there is no transaction to join). */
export async function writeExportAudit(db: Firestore, actor: Actor, spec: ReportSpec, rowCount: number, truncated: boolean): Promise<void> {
  const ref = doc(collection(db, COLLECTIONS.auditLogs));
  await setDoc(
    ref,
    auditDocData(actor, {
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: spec.report,
      entityLabel: `${REPORT_LABELS[spec.report]} report`,
      metadata: exportAuditMetadata(spec, rowCount, truncated),
    }),
  );
}

export async function exportReportFor(db: Firestore, req: ExportRequest): Promise<ExportedReport> {
  const { spec, actor } = req;
  if (actor.role !== 'ADMIN') throw new AppError('PERMISSION_DENIED');
  if (planReport(spec) === null) throw new AppError('INVALID_DATA', { userMessage: 'Check the dates: there is nothing to export for this range.' });

  const cap = req.maxRows ?? EXPORT_MAX_ROWS;
  const result = await runCsvExport({
    header: reportHeaders(spec.report),
    fetchPage: (cursor, size) => listReportPageFor(db, spec, cursor, size),
    toRow: (record) => reportRow(spec, record),
    maxRows: cap,
    pageSize: req.pageSize ?? EXPORT_PAGE_SIZE,
    signal: req.signal,
    onProgress: req.onProgress,
  });

  if (req.signal?.aborted) throw new ExportCancelledError(); // last chance to stop before anything is recorded or released
  try {
    await writeExportAudit(db, actor, spec, result.rowCount, result.truncated);
  } catch (e) {
    const mapped = mapFirebaseError(e);
    throw new AppError(mapped.kind, {
      cause: e,
      userMessage: `The export could not be recorded in the audit log. ${mapped.userMessage}`,
    });
  }
  return {
    fileName: exportFileName(spec.report, (req.now ?? (() => new Date()))(), result.truncated ? result.rowCount : null),
    chunks: result.chunks,
    rowCount: result.rowCount,
    truncated: result.truncated,
  };
}
