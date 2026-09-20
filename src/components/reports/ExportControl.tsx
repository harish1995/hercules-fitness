import DownloadIcon from '@mui/icons-material/Download';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { EXPORT_MAX_ROWS } from '../../domain/reports';
import { useReportExport } from '../../hooks/useReportExport';
import { type ReportSpec } from '../../types/report';

/**
 * Export CSV for the report on screen (US-6.2): same filters and columns, fetched in pages with a progress bar and a Cancel
 * button, capped at EXPORT_MAX_ROWS (the user is told when the cap cut the file short), and downloaded only once complete.
 * Render it with a `key` that changes with the filters, so a running export never outlives the filters it was started with.
 */
export function ExportControl({ spec, disabled }: { spec: ReportSpec; disabled: boolean }) {
  const { state, start, cancel } = useReportExport();
  const running = state.phase === 'running';
  const cap = EXPORT_MAX_ROWS.toLocaleString('en-IN');

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => start(spec)} disabled={disabled || running}>
          Export CSV
        </Button>
        {running && (
          <Button variant="outlined" color="inherit" onClick={cancel}>
            Cancel
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">
          Up to {cap} rows per export, same filters and columns as the table.
        </Typography>
      </Stack>

      {running && (
        <Box sx={{ mt: 1.5, maxWidth: 420 }} role="status" aria-live="polite">
          <LinearProgress
            variant={state.cap > 0 ? 'determinate' : 'indeterminate'}
            value={state.cap > 0 ? Math.min(100, (state.rows / state.cap) * 100) : 0}
            aria-label="Export progress"
          />
          <Typography variant="caption" color="text.secondary">
            {state.rows.toLocaleString('en-IN')} row{state.rows === 1 ? '' : 's'} fetched…
          </Typography>
        </Box>
      )}
      {state.phase === 'done' && !state.truncated && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          Exported {state.rowCount.toLocaleString('en-IN')} row{state.rowCount === 1 ? '' : 's'} to {state.fileName}.
        </Alert>
      )}
      {state.phase === 'done' && state.truncated && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          Only the first {state.rowCount.toLocaleString('en-IN')} rows were exported: more rows match these filters than one export
          can hold. Narrow the date range and export again to get the rest. The file name ends in "first-{state.rowCount}-rows".
        </Alert>
      )}
      {state.phase === 'cancelled' && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Export cancelled. No file was created.
        </Alert>
      )}
      {state.phase === 'error' && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {state.message} No file was created.
        </Alert>
      )}
    </Box>
  );
}
