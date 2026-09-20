import { Box, Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { defaultReportFilters, EXPIRING_WINDOW_DAYS, isNumericHeader, REPORT_DATE_FILTERS, REPORT_LABELS, reportHeaders, reportRow } from '../../domain/reports';
import { addIstDays, parseDayInput, todayIstStart, toDayInputValue } from '../../domain/dates';
import { planReport, reportRangeError, REPORT_PAGE_SIZE } from '../../domain/reportQueryPlans';
import { useAsyncData } from '../../hooks/useAsyncData';
import { usePagedList } from '../../hooks/usePagedList';
import { toUserMessage } from '../../services/errors';
import { getReportTotals, listReportPage } from '../../services/reportService';
import { type ReportAttendanceStatus, type ReportId, type ReportRecord, type ReportSpec } from '../../types/report';
import { PagerBar } from '../common/PagerBar';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { LoadingState } from '../feedback/LoadingState';
import { ExportControl } from './ExportControl';
import { ReportTotalsView } from './ReportTotalsView';

const NOUN: Record<ReportId, string> = {
  MEMBERS: 'member',
  EXPIRED: 'member',
  EXPIRING: 'member',
  REVENUE: 'payment',
  ATTENDANCE: 'record',
  PENDING: 'member',
};

const STATUS_CHOICES: { value: ReportAttendanceStatus; label: string }[] = [
  { value: 'ALL', label: 'Present and absent' },
  { value: 'PRESENT', label: 'Present only' },
  { value: 'ABSENT', label: 'Absent only' },
];

/**
 * One report: its date filters, the totals (aggregations), the table (server-side cursor pagination, 25 per page) and the CSV
 * export. The table, the totals and the export all come from ONE `ReportSpec`, so they always agree (US-6.2a). No collection is
 * loaded in full: a range that is inverted (rejected, US-6.1b) or cannot match issues no query at all.
 */
export function ReportPanel({ report }: { report: ReportId }) {
  const today = todayIstStart();
  const [filters, setFilters] = useState(() => defaultReportFilters(report, todayIstStart()));
  const fromDate = parseDayInput(filters.from);
  const toDate = parseDayInput(filters.to);

  // A plain object each render is fine: every consumer is keyed by `key` below (day timestamps + status), never by identity.
  const spec: ReportSpec =
    report === 'ATTENDANCE' ? { report, from: fromDate, to: toDate, today, status: filters.status } : { report, from: fromDate, to: toDate, today };
  const invalid = reportRangeError(spec) !== null;
  const noQuery = planReport(spec) === null;
  const key = `${report}:${spec.from?.getTime() ?? ''}:${spec.to?.getTime() ?? ''}:${spec.today.getTime()}:${spec.report === 'ATTENDANCE' ? spec.status : ''}`;

  const list = usePagedList<ReportRecord>((cursor) => (noQuery ? Promise.resolve({ items: [], next: null }) : listReportPage(spec, cursor)), `report-rows:${key}`);
  const totals = useAsyncData(() => (noQuery ? Promise.resolve(null) : getReportTotals(spec)), `report-totals:${key}`);

  const labels = REPORT_DATE_FILTERS[report];
  const headers = reportHeaders(report);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = fromDate !== null || toDate !== null;

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label={labels.from}
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <TextField
            label={labels.to}
            type="date"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            error={invalid}
            helperText={invalid ? 'The end date is before the start date' : 'Inclusive whole days (IST)'}
            sx={{ flex: 1 }}
          />
          {report === 'EXPIRING' && (
            <TextField
              select
              label="Quick window"
              value=""
              onChange={(e) => {
                const days = Number(e.target.value);
                set({ from: toDayInputValue(today), to: toDayInputValue(addIstDays(today, days)) });
              }}
              sx={{ flex: 1 }}
              helperText="Sets the dates from today"
            >
              {EXPIRING_WINDOW_DAYS.map((d) => (
                <MenuItem key={d} value={d}>
                  {d === 1 ? 'Today and tomorrow' : `Next ${d} days`}
                </MenuItem>
              ))}
            </TextField>
          )}
          {report === 'ATTENDANCE' && (
            <TextField
              select
              label="Show"
              value={filters.status}
              onChange={(e) => set({ status: STATUS_CHOICES.find((c) => c.value === e.target.value)?.value ?? 'ALL' })}
              sx={{ flex: 1 }}
            >
              {STATUS_CHOICES.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box sx={{ alignSelf: 'flex-start' }}>
            <Button onClick={() => setFilters(defaultReportFilters(report, today))}>Reset filters</Button>
          </Box>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {labels.help}
        </Typography>
      </Paper>

      <Box sx={{ mb: 2 }}>
        <ExportControl key={key} spec={spec} disabled={noQuery || list.status !== 'success' || list.items.length === 0} />
      </Box>

      {totals.data && !noQuery && <ReportTotalsView totals={totals.data} noun={NOUN[report]} />}
      {totals.status === 'error' && !noQuery && (
        <Typography variant="body2" color="error" role="alert" sx={{ mb: 2 }}>
          The totals could not be loaded: {toUserMessage(totals.error)}{' '}
          <Button size="small" onClick={totals.reload}>
            Retry
          </Button>
        </Typography>
      )}

      {invalid ? (
        <EmptyState title="Check the dates" description="The end date is before the start date." />
      ) : noQuery ? (
        <EmptyState title="Nothing in this range" description={report === 'EXPIRED' ? 'Expired memberships ended before today: the range starts after that.' : 'No membership can match this range.'} />
      ) : list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label={`Loading the ${REPORT_LABELS[report].toLowerCase()} report…`} />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load this report" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState title="No rows found" description={filtered ? 'Nothing matches these dates. Try a wider range.' : 'Nothing to report yet.'} />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label={`${REPORT_LABELS[report]} report`} size="small" sx={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
              <TableHead>
                <TableRow>
                  {headers.map((h) => (
                    <TableCell key={h} align={isNumericHeader(h) ? 'right' : 'left'}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {list.items.map((rec, i) => (
                  <TableRow key={`${list.pageIndex}-${i}`} hover>
                    {reportRow(spec, rec).map((cell, c) => (
                      <TableCell key={c} align={isNumericHeader(headers[c] ?? '') ? 'right' : 'left'}>
                        {cell === null || cell === undefined ? '' : String(cell)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <PagerBar list={list} pageSize={REPORT_PAGE_SIZE} />
        </Paper>
      )}
    </>
  );
}
