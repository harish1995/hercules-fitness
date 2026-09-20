import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { MemberAttendanceDialog } from '../../components/attendance/MemberAttendanceDialog';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberStatusBadge } from '../../components/members/MemberStatusBadge';
import { MembershipDialog } from '../../components/memberships/MembershipDialog';
import { RecordPaymentDialog } from '../../components/payments/RecordPaymentDialog';
import { SuspendDialog } from '../../components/memberships/SuspendDialog';
import { memberEditPath, memberProfilePath, ROUTES } from '../../constants/routes';
import { formatIstDate, parseDayInput, todayIstStart } from '../../domain/dates';
import { browseDayRange, PAGE_SIZE } from '../../domain/memberQueryPlan';
import { formatInr } from '../../domain/money';
import { isDateBucket } from '../../domain/queryPredicates';
import { inferSearch } from '../../domain/search';
import { useActor } from '../../hooks/useActor';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useMembersList } from '../../hooks/useMembersList';
import { usePlans } from '../../hooks/usePlans';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { softDeleteMember } from '../../services/memberService';
import { type Member, type MemberListQuery, type MemberListSort, type MemberListStatus } from '../../types/member';

const SEARCH_HINT = 'Search by name, mobile or Member ID. Matches the start only (e.g. "rah" finds Rahul, "ahul" does not).';
const FILTERS_DISABLED_WHILE_SEARCHING = 'Filters are unavailable while searching. Clear the search to filter.';

const STATUS_VALUES: readonly MemberListStatus[] = ['ALL', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'SUSPENDED', 'NO_MEMBERSHIP'];
const EXPIRY_SORT_TIP = 'Choose Active, Expiring soon, Expired or an expiry date range to sort by expiry.';

/**
 * Members list (US-2.8, US-3.8). Everything is server-side: cursor pagination (25 per page), indexed prefix search,
 * and only the supported filter/sort combinations (architecture §5.3): status and plan and an expiry range; a date filter
 * forces the expiry sort; a search term disables every filter (they are never applied to the current page only). Status
 * filters use the SAME predicates as the dashboard cards, so a card's number equals its list.
 */
export function MembersListPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = actor?.role === 'ADMIN';

  const [params] = useSearchParams();
  const initialStatus = STATUS_VALUES.find((v) => v === params.get('status')) ?? 'ALL';
  const plans = usePlans();

  const [text, setText] = useState('');
  const [status, setStatus] = useState<MemberListStatus>(initialStatus);
  const [planId, setPlanId] = useState('');
  const [expiryFrom, setExpiryFrom] = useState('');
  const [expiryTo, setExpiryTo] = useState('');
  const [sort, setSort] = useState<MemberListSort>('EXPIRY_ASC');
  const debounced = useDebouncedValue(text, 300);
  const search = inferSearch(debounced);
  const searching = inferSearch(text).kind !== 'none';

  // Expiry-range and plan inputs only apply where the matrix supports them (rows 2-6); otherwise they are disabled and ignored.
  const flagStatus = status === 'SUSPENDED' || status === 'NO_MEMBERSHIP';
  const rangeSupported = !flagStatus;
  const planSupported = status !== 'NO_MEMBERSHIP';
  const from = rangeSupported ? parseDayInput(expiryFrom) : null;
  const to = rangeSupported ? parseDayInput(expiryTo) : null;
  const dateFilter = isDateBucket(status) || from !== null || to !== null;
  // rule 9: a date filter forces the expiry sort; without one only "registered" exists
  const effectiveSort: MemberListSort = dateFilter ? (sort === 'EXPIRY_DESC' ? 'EXPIRY_DESC' : 'EXPIRY_ASC') : 'REGISTERED';

  // The hook keys its requests on the serialized query, so a fresh object each render is fine.
  const browseQuery: Extract<MemberListQuery, { mode: 'browse' }> = {
    mode: 'browse',
    status,
    planId: planSupported && planId !== '' ? planId : null,
    expiryFrom: from,
    expiryTo: to,
    sort: effectiveSort,
    today: todayIstStart(),
  };
  const query: MemberListQuery =
    search.kind === 'none' ? browseQuery : { mode: 'search', kind: search.kind, term: search.term };
  const list = useMembersList(query);
  const emptyRange = search.kind === 'none' && browseDayRange(browseQuery) === 'empty';

  const [renewing, setRenewing] = useState<Member | null>(null);
  const [suspending, setSuspending] = useState<Member | null>(null);
  const [paying, setPaying] = useState<Member | null>(null);
  const [attending, setAttending] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function doDelete() {
    if (!toDelete || !actor) return;
    setDeleting(true);
    try {
      await softDeleteMember({ memberDocId: toDelete.id, actor });
      toast.success(`${toDelete.displayName} was deleted.`);
      setToDelete(null);
      list.reload();
    } catch (e) {
      toast.error(toUserMessage(e));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const filterTip = searching ? FILTERS_DISABLED_WHILE_SEARCHING : '';
  const filtersActive = query.mode === 'browse' && (query.status !== 'ALL' || query.planId !== null || dateFilter);
  const planName = (id: string | null) => (id ? (plans.data ?? []).find((p) => p.id === id)?.name : undefined);

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={dateFilter && search.kind === 'none' ? 'Sorted by expiry date' : 'Newest registered first'}
        actions={
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button component={RouterLink} to={ROUTES.membersExpiring} variant="outlined">
              Expiring soon
            </Button>
            <Button component={RouterLink} to={ROUTES.membersExpired} variant="outlined">
              Expired
            </Button>
            <Button component={RouterLink} to={ROUTES.memberNew} variant="contained" startIcon={<AddIcon />}>
              Register member
            </Button>
          </Stack>
        }
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack spacing={2}>
          <TextField
            label="Search members"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, mobile or Member ID"
            helperText={SEARCH_HINT}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Tooltip title={filterTip} placement="top">
              <Box sx={{ flex: 1 }}>
                <TextField
                  select
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MemberListStatus)}
                  disabled={searching}
                  helperText={searching ? FILTERS_DISABLED_WHILE_SEARCHING : 'Active, Expiring and Expired exclude suspended members'}
                >
                  <MenuItem value="ALL">All members</MenuItem>
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="EXPIRING_SOON">Expiring soon</MenuItem>
                  <MenuItem value="EXPIRED">Expired</MenuItem>
                  <MenuItem value="SUSPENDED">Suspended</MenuItem>
                  <MenuItem value="NO_MEMBERSHIP">No membership</MenuItem>
                </TextField>
              </Box>
            </Tooltip>
            <Tooltip title={filterTip} placement="top">
              <Box sx={{ flex: 1 }}>
                <TextField
                  select
                  label="Plan"
                  value={planSupported ? planId : ''}
                  onChange={(e) => setPlanId(e.target.value)}
                  disabled={searching || !planSupported}
                  helperText={searching ? FILTERS_DISABLED_WHILE_SEARCHING : 'The plan of the latest membership'}
                >
                  <MenuItem value="">All plans</MenuItem>
                  {(plans.data ?? []).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                      {p.active ? '' : ' (inactive)'}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Tooltip>
            <Tooltip title={searching ? filterTip : !dateFilter ? EXPIRY_SORT_TIP : ''} placement="top">
              <Box sx={{ flex: 1 }}>
                <TextField
                  select
                  label="Sort"
                  value={effectiveSort}
                  onChange={(e) => setSort(e.target.value as MemberListSort)}
                  disabled={searching}
                  helperText={searching ? 'Ordered by the searched field' : dateFilter ? 'Sorted by expiry date' : EXPIRY_SORT_TIP}
                >
                  <MenuItem value="REGISTERED" disabled={dateFilter}>
                    Registered (newest first)
                  </MenuItem>
                  <MenuItem value="EXPIRY_ASC" disabled={!dateFilter}>
                    Expiry date (soonest first)
                  </MenuItem>
                  <MenuItem value="EXPIRY_DESC" disabled={!dateFilter}>
                    Expiry date (latest first)
                  </MenuItem>
                </TextField>
              </Box>
            </Tooltip>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              label="Expires from"
              type="date"
              value={expiryFrom}
              onChange={(e) => setExpiryFrom(e.target.value)}
              disabled={searching || !rangeSupported}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={!rangeSupported ? 'Not available for this status' : undefined}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Expires to"
              type="date"
              value={expiryTo}
              onChange={(e) => setExpiryTo(e.target.value)}
              disabled={searching || !rangeSupported}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Inclusive; combined with the status when both are set"
              sx={{ flex: 1 }}
            />
            <Box sx={{ flex: 1 }} />
          </Stack>
        </Stack>
      </Paper>

      {list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label="Loading members…" />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load members" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        emptyRange ? (
          <EmptyState title="No members found" description="The status and the expiry dates do not overlap, so no member can match. Change the dates or the status." />
        ) : searching || filtersActive ? (
          <EmptyState title="No members found" description="No member matches. Search matches the start of a name, mobile number or Member ID." />
        ) : (
          <EmptyState
            title="No members yet"
            description="Register your first member to get started."
            action={
              <Button component={RouterLink} to={ROUTES.memberNew} variant="contained">
                Register member
              </Button>
            }
          />
        )
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Members" sx={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Member ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Expiry</TableCell>
                  <TableCell align="right">Pending</TableCell>
                  <TableCell>Joined</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.items.map((m) => (
                  <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => void navigate(memberProfilePath(m.id))}>
                    <TableCell>{m.memberId}</TableCell>
                    <TableCell>{m.displayName}</TableCell>
                    <TableCell>{m.mobile}</TableCell>
                    <TableCell>
                      <MemberStatusBadge member={m} />
                    </TableCell>
                    <TableCell>{m.membership.planName ?? planName(m.membership.planId) ?? '—'}</TableCell>
                    <TableCell>{m.membership.endDate ? formatIstDate(m.membership.endDate) : '—'}</TableCell>
                    <TableCell align="right">{m.hasMembership ? formatInr(m.pendingPaise) : '—'}</TableCell>
                    <TableCell>{formatIstDate(m.joiningDate)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Button size="small" component={RouterLink} to={memberProfilePath(m.id)}>
                        View
                      </Button>
                      {actor && (
                        <Button size="small" onClick={() => setAttending(m.id)}>
                          Attendance
                        </Button>
                      )}
                      {isAdmin && (
                        <>
                          <Button size="small" component={RouterLink} to={memberEditPath(m.id)}>
                            Edit
                          </Button>
                          {m.hasMembership && (
                            <Button size="small" onClick={() => setRenewing(m)} disabled={m.suspended} title={m.suspended ? 'Reactivate the member before renewing' : undefined}>
                              Renew
                            </Button>
                          )}
                          {m.hasMembership && (
                            <Button size="small" onClick={() => setPaying(m)} disabled={m.pendingPaise <= 0} title={m.pendingPaise <= 0 ? 'Nothing is pending for this member' : undefined}>
                              Payment
                            </Button>
                          )}
                          {(m.hasMembership || m.suspended) && (
                            <Button size="small" color="warning" onClick={() => setSuspending(m)}>
                              {m.suspended ? 'Reactivate' : 'Suspend'}
                            </Button>
                          )}
                          <Button size="small" color="error" onClick={() => setToDelete(m)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <PagerBar list={list} pageSize={PAGE_SIZE} />
        </Paper>
      )}

      {renewing && (
        <MembershipDialog
          mode="renew"
          member={renewing}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            list.reload();
          }}
        />
      )}
      {paying && (
        <RecordPaymentDialog
          member={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            list.reload();
          }}
        />
      )}
      {attending && <MemberAttendanceDialog memberDocId={attending} onClose={() => setAttending(null)} onChanged={() => undefined} />}
      {suspending && (
        <SuspendDialog
          member={suspending}
          onClose={() => setSuspending(null)}
          onDone={() => {
            setSuspending(null);
            list.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.displayName ?? 'member'}?`}
        message="The member is hidden from all lists, counts and search. History is kept and nothing is permanently erased. There is no undo in this version."
        confirmLabel="Delete member"
        destructive
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
