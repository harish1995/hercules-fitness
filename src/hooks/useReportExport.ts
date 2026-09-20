import { useCallback, useEffect, useRef, useState } from 'react';
import { ExportCancelledError, exportReport } from '../services/reportService';
import { toUserMessage } from '../services/errors';
import { type ReportSpec } from '../types/report';
import { downloadTextFile } from '../utils/download';
import { useActor } from './useActor';

export type ReportExportState =
  | { phase: 'idle' }
  | { phase: 'running'; rows: number; cap: number }
  | { phase: 'done'; rowCount: number; truncated: boolean; fileName: string }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string };

/**
 * Drives one CSV export of a report: paged fetch with progress, Cancel, the audit record, then the download. Only a fully
 * fetched AND audited export is downloaded; a cancel or a failure leaves no file (US-6.2f). Unmounting (or the caller
 * remounting it with a new `key` when the filters change) cancels a running export.
 */
export function useReportExport(): { state: ReportExportState; start: (spec: ReportSpec) => void; cancel: () => void } {
  const actor = useActor();
  const [state, setState] = useState<ReportExportState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(
    (spec: ReportSpec) => {
      if (controller.current) return; // one export at a time
      if (!actor) {
        setState({ phase: 'error', message: 'You do not have permission to do that.' });
        return;
      }
      const ctl = new AbortController();
      controller.current = ctl;
      setState({ phase: 'running', rows: 0, cap: 0 });
      exportReport({
        spec,
        actor,
        signal: ctl.signal,
        onProgress: (p) => {
          if (!ctl.signal.aborted) setState({ phase: 'running', rows: p.rows, cap: p.cap });
        },
      })
        .then((result) => {
          if (ctl.signal.aborted) {
            setState({ phase: 'cancelled' });
            return;
          }
          downloadTextFile(result.fileName, result.chunks);
          setState({ phase: 'done', rowCount: result.rowCount, truncated: result.truncated, fileName: result.fileName });
        })
        .catch((e: unknown) => {
          if (e instanceof ExportCancelledError || ctl.signal.aborted) setState({ phase: 'cancelled' });
          else setState({ phase: 'error', message: toUserMessage(e) });
        })
        .finally(() => {
          controller.current = null;
        });
    },
    [actor],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);
  return { state, start, cancel };
}
