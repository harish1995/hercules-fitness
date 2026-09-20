import { Box, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { PAYMENT_METHOD_LABELS } from '../../constants/enums';
import { formatInr } from '../../domain/money';
import { type ReportTotals } from '../../types/report';

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" component="p">
        {value}
      </Typography>
    </Box>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** The figures above a report's table (aggregations): money is formatted to rupees here, at the edge, from integer paise. */
export function ReportTotalsView({ totals, noun }: { totals: ReportTotals; noun: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} aria-label="Report totals">
      {totals.kind === 'count' && <Figure label="Matching rows" value={plural(totals.count, noun, `${noun}s`)} />}
      {totals.kind === 'pending' && (
        <Stack direction="row" spacing={4}>
          <Figure label="Total pending" value={formatInr(totals.totalPaise)} />
          <Figure label="Members owing" value={totals.memberCount.toLocaleString('en-IN')} />
        </Stack>
      )}
      {totals.kind === 'attendance' && (
        <Stack direction="row" spacing={4}>
          <Figure label="Present records in range" value={totals.present.toLocaleString('en-IN')} />
          <Figure label="Marked absent in range" value={totals.absent.toLocaleString('en-IN')} />
        </Stack>
      )}
      {totals.kind === 'revenue' && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={4}>
            <Figure label="Total revenue" value={formatInr(totals.total.totalPaise)} />
            <Figure label="Payments" value={totals.total.count.toLocaleString('en-IN')} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <TotalsTable
              caption="By payment mode"
              first="Mode"
              rows={totals.byMethod.map((m) => ({ label: PAYMENT_METHOD_LABELS[m.method], totalPaise: m.totalPaise, count: m.count }))}
            />
            {totals.breakdown ? (
              <TotalsTable
                caption={totals.breakdown.granularity === 'DAY' ? 'By day' : 'By month (the first and last month are cut to the dates above)'}
                first={totals.breakdown.granularity === 'DAY' ? 'Day' : 'Month'}
                rows={totals.breakdown.rows}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                Set both dates (at most 36 months apart) to see revenue per day or per month.
              </Typography>
            )}
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}

function TotalsTable({ caption, first, rows }: { caption: string; first: string; rows: { label: string; totalPaise: number; count: number }[] }) {
  return (
    <TableContainer sx={{ flex: 1, maxHeight: 320 }}>
      <Table size="small" stickyHeader aria-label={caption}>
        <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600 }}>{caption}</caption>
        <TableHead>
          <TableRow>
            <TableCell>{first}</TableCell>
            <TableCell align="right">Payments</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell>{r.label}</TableCell>
              <TableCell align="right">{r.count}</TableCell>
              <TableCell align="right">{formatInr(r.totalPaise)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
