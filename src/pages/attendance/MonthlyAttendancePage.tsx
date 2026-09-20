import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, InputAdornment, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { memberProfilePath, ROUTES } from '../../constants/routes';
import { formatIstDate, nowIst } from '../../domain/dates';
import { PAGE_SIZE } from '../../domain/memberQueryPlan';
import { inferSearch } from '../../domain/search';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useMembersList } from '../../hooks/useMembersList';
import { getMemberMonthPresentCounts, getMonthlyDayCounts } from '../../services/attendanceService';
import { toUserMessage } from '../../services/errors';
import { type MemberListQuery } from '../../types/member';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS_BACK = 5;

/**
 * Monthly attendance report (US-5.6). The month is an IST calendar month (a record at 23:50 IST on the last day belongs to it).
 * Everything is a `count()` aggregation or a cursor page, never a collection load:
 *   per-day figures    one count per day of the month up to today (at most 31), plus the month total;
 *   per-member figures the members are listed page by page (25) with the same indexed list / prefix search as the Members list,
 *                      and only the members ON SCREEN get a count of their PRESENT days (one aggregation each).
 * Members with no attendance show 0. A PRESENT record is one visit (one record per member per day), so "days present" and
 * "visits" are the same number.
 */
export function MonthlyAttendancePage() {
  const now = nowIst();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, 300);
  const search = inferSearch(debounced);
  const searching = inferSearch(text).kind !== 'none';

  // never a month in the future
  const maxMonth = year === now.year ? now.month : 12;
  const effectiveMonth = Math.min(month, maxMonth);
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => now.year - i);
  const label = `${MONTH_NAMES[effectiveMonth - 1]} ${year}`;

  const days = useAsyncData(() => getMonthlyDayCounts(year, effectiveMonth), `att-days:${year}-${effectiveMonth}`);
  const query: MemberListQuery =
    search.kind === 'none'
      ? { mode: 'browse', status: 'ALL', planId: null, expiryFrom: null, expiryTo: null, sort: 'REGISTERED', today: new Date(0) }
      : { mode: 'search', kind: search.kind, term: search.term };
  const members = useMembersList(query);
  const ids = members.items.map((m) => m.id);
  const memberCounts = useAsyncData(
    () => (ids.length === 0 ? Promise.resolve<Record<string, number>>({}) : getMemberMonthPresentCounts(ids, year, effectiveMonth)),
    `att-member-counts:${year}-${effectiveMonth}:${ids.join(',')}`,
  );
  const total = days.data?.reduce((sum, d) => sum + d.present, 0);

  return (
    <>
      <PageHeader
        title="Monthly attendance"
        subtitle={`${label} (IST months)`}
        actions={
          <Button component={RouterLink} to={ROUTES.attendance} variant="outlined">
            Today's attendance
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Month" value={effectiveMonth} onChange={(e) => setMonth(Number(e.target.value))} sx={{ minWidth: 160 }}>
            {MONTH_NAMES.map((name, i) => (
              <MenuItem key={name} value={i + 1} disabled={i + 1 > maxMonth}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ minWidth: 120 }}>
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }} component="section" aria-label="Attendance by day">
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
          By day
        </Typography>
        {days.status === 'error' ? (
          <ErrorState title="Could not load the daily figures" message={toUserMessage(days.error)} onRetry={days.reload} />
        ) : days.data === undefined ? (
          <LoadingState label="Loading…" />
        ) : total === 0 ? (
          <EmptyState title={`No attendance recorded in ${label}`} description="Check-ins made in this month will be counted here." />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {total} check-in{total === 1 ? '' : 's'} (present records) in {label}
            </Typography>
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table size="small" stickyHeader aria-label="Present count per day">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Present</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {days.data.map((d) => (
                    <TableRow key={d.date.getTime()}>
                      <TableCell>{formatIstDate(d.date)}</TableCell>
                      <TableCell align="right">{d.present}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Attendance by member">
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          By member
        </Typography>
        <TextField
          label="Search members"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, mobile or Member ID"
          helperText="Matches the start only. Members are listed 25 per page; the days present are counted for the members shown."
          fullWidth
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <Box sx={{ mt: 2 }}>
          {members.status === 'loading' && members.items.length === 0 ? (
            <LoadingState label="Loading members…" />
          ) : members.status === 'error' ? (
            <ErrorState title="Could not load members" message={toUserMessage(members.error)} onRetry={members.reload} />
          ) : members.items.length === 0 ? (
            <EmptyState title={searching ? 'No members found' : 'No members yet'} />
          ) : (
            <>
              {memberCounts.status === 'error' && (
                <Typography color="error" variant="body2" role="alert" sx={{ mb: 1 }}>
                  {toUserMessage(memberCounts.error)}
                </Typography>
              )}
              <TableContainer>
                <Table size="small" aria-label="Days present per member" sx={{ opacity: members.status === 'loading' ? 0.6 : 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Member ID</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell align="right">Days present in {label}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {members.items.map((m) => {
                      const n = memberCounts.data?.[m.id];
                      return (
                        <TableRow key={m.id} hover>
                          <TableCell>{m.memberId}</TableCell>
                          <TableCell>
                            <RouterLink to={memberProfilePath(m.id)}>{m.displayName}</RouterLink>
                          </TableCell>
                          <TableCell align="right">{n !== undefined ? n : memberCounts.status === 'error' ? '–' : '…'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <PagerBar list={members} pageSize={PAGE_SIZE} />
            </>
          )}
        </Box>
      </Paper>
    </>
  );
}
