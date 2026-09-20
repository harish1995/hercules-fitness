import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, Chip, InputAdornment, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { AttendanceTable } from '../../components/attendance/AttendanceTable';
import { MemberAttendanceDialog } from '../../components/attendance/MemberAttendanceDialog';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberStatusBadge } from '../../components/members/MemberStatusBadge';
import { memberProfilePath, ROUTES } from '../../constants/routes';
import { ATTENDANCE_PAGE_SIZE } from '../../domain/attendanceQueryPlans';
import { formatIstDate, todayIstStart } from '../../domain/dates';
import { PAGE_SIZE } from '../../domain/memberQueryPlan';
import { inferSearch } from '../../domain/search';
import { useActor } from '../../hooks/useActor';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePagedList } from '../../hooks/usePagedList';
import { useToast } from '../../hooks/useToast';
import { getTodayAttendanceCounts, listTodayAttendance, checkOut } from '../../services/attendanceService';
import { toUserMessage } from '../../services/errors';
import { listMembers } from '../../services/memberService';
import { type AttendanceRecord, type TodayAttendanceFilter } from '../../types/attendance';
import { type Member, type MemberListQuery } from '../../types/member';

const SEARCH_HINT = 'Search by name, mobile or Member ID. Matches the start only (e.g. "rah" finds Rahul, "ahul" does not).';
const FILTER_LABELS: Record<TodayAttendanceFilter, string> = { ALL: 'All today', CHECKED_IN: 'Checked in now', ABSENT: 'Absent' };

/**
 * Attendance (US-5.1 to US-5.4): find a member with the indexed PREFIX search (never a full member load: nothing is listed until
 * something is typed), check in / out / mark absent through the dialog, and see TODAY's records (IST) with server-side cursor
 * pagination. "Checked in now" is the same predicate as the dashboard card. The page is dated by the IST day of the moment it
 * renders; Refresh recomputes it, so a page left open past midnight switches to the new day (US-5.4c).
 */
export function AttendancePage() {
  const actor = useActor();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const today = todayIstStart();
  const dayKey = today.getTime();
  const [filter, setFilter] = useState<TodayAttendanceFilter>('ALL');
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, 300);
  const search = inferSearch(debounced);
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [outBusy, setOutBusy] = useState<string | null>(null);

  const counts = useAsyncData(() => getTodayAttendanceCounts(), `att-counts:${dayKey}:${refreshKey}`);
  const list = usePagedList<AttendanceRecord>((cursor) => listTodayAttendance(filter, today, cursor), `att-today:${dayKey}:${filter}:${refreshKey}`);
  // Member picker: the SAME indexed prefix-search query as the Members list. With no search text NO query is issued (an empty
  // prefix would match every member), so the page never loads the member collection.
  const pickerActive = search.kind !== 'none';
  const pickerQuery: MemberListQuery | null = search.kind === 'none' ? null : { mode: 'search', kind: search.kind, term: search.term };
  const picker = usePagedList<Member>(
    (cursor) => (pickerQuery ? listMembers(pickerQuery, cursor) : Promise.resolve({ items: [], next: null })),
    `att-picker:${JSON.stringify(pickerQuery)}`,
  );

  function changed() {
    setRefreshKey((k) => k + 1);
  }

  async function doCheckOut(r: AttendanceRecord) {
    if (!actor) return;
    setOutBusy(r.memberDocId);
    try {
      await checkOut({ memberDocId: r.memberDocId, actor });
      toast.success(`${r.memberName} checked out.`);
      changed();
    } catch (e) {
      toast.error(toUserMessage(e));
      changed();
    } finally {
      setOutBusy(null);
    }
  }

  const stillIn = counts.data?.currentlyCheckedIn;

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Today: ${formatIstDate(today)} (IST)`}
        actions={
          <Stack direction="row" spacing={1}>
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={changed}>
              Refresh
            </Button>
            <Button component={RouterLink} to={ROUTES.attendanceMonthly} variant="outlined">
              Monthly report
            </Button>
          </Stack>
        }
      />

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }} aria-label="Today's counts">
        <Chip color="info" label={`Currently checked in: ${stillIn ?? (counts.status === 'error' ? '–' : '…')}`} />
        <Chip variant="outlined" label={`Present today: ${counts.data?.todayPresent ?? (counts.status === 'error' ? '–' : '…')}`} />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} component="section" aria-label="Find a member">
        <TextField
          label="Find a member"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, mobile or Member ID"
          helperText={SEARCH_HINT}
          fullWidth
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        {pickerActive && (
          <Box sx={{ mt: 2 }}>
            {picker.status === 'loading' && picker.items.length === 0 ? (
              <LoadingState label="Searching…" />
            ) : picker.status === 'error' ? (
              <ErrorState title="Could not search members" message={toUserMessage(picker.error)} onRetry={picker.reload} />
            ) : picker.items.length === 0 ? (
              <EmptyState title="No members found" description="Search matches the start of a name, mobile number or Member ID." />
            ) : (
              <>
                <TableContainer>
                  <Table size="small" aria-label="Members found" sx={{ opacity: picker.status === 'loading' ? 0.6 : 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Member ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Mobile</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {picker.items.map((m) => (
                        <TableRow key={m.id} hover>
                          <TableCell>{m.memberId}</TableCell>
                          <TableCell>
                            <RouterLink to={memberProfilePath(m.id)}>{m.displayName}</RouterLink>
                          </TableCell>
                          <TableCell>{m.mobile}</TableCell>
                          <TableCell>
                            <MemberStatusBadge member={m} />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" variant="contained" onClick={() => setDialogFor(m.id)} aria-label={`Check in or out ${m.displayName}`}>
                              Check in / out
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <PagerBar list={picker} pageSize={PAGE_SIZE} />
              </>
            )}
          </Box>
        )}
        {!pickerActive && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Members are found by search only, so this stays fast with any number of members.
          </Typography>
        )}
      </Paper>

      <Paper variant="outlined" component="section" aria-label="Today's attendance">
        <Stack direction="row" sx={{ p: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            Today's attendance
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v: TodayAttendanceFilter | null) => v && setFilter(v)} aria-label="Filter today's attendance">
            {(Object.keys(FILTER_LABELS) as TodayAttendanceFilter[]).map((f) => (
              <ToggleButton key={f} value={f}>
                {FILTER_LABELS[f]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
        {list.status === 'loading' && list.items.length === 0 ? (
          <LoadingState label="Loading today's attendance…" />
        ) : list.status === 'error' ? (
          <ErrorState title="Could not load attendance" message={toUserMessage(list.error)} onRetry={list.reload} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={filter === 'ALL' ? 'No attendance recorded today' : filter === 'CHECKED_IN' ? 'Nobody is checked in right now' : 'Nobody is marked absent today'}
            description="Find a member above to check them in."
          />
        ) : (
          <>
            <AttendanceTable
              records={list.items}
              label="Today's attendance"
              showMember
              now={new Date()}
              dim={list.status === 'loading'}
              actions={(r) =>
                r.status === 'PRESENT' && !r.checkedOut ? (
                  <Button size="small" onClick={() => void doCheckOut(r)} disabled={outBusy === r.memberDocId}>
                    Check out
                  </Button>
                ) : r.status === 'ABSENT' ? (
                  <Button size="small" onClick={() => setDialogFor(r.memberDocId)}>
                    Check in
                  </Button>
                ) : null
              }
            />
            <PagerBar list={list} pageSize={ATTENDANCE_PAGE_SIZE} />
          </>
        )}
      </Paper>

      {dialogFor && <MemberAttendanceDialog memberDocId={dialogFor} onClose={() => setDialogFor(null)} onChanged={changed} />}
    </>
  );
}
