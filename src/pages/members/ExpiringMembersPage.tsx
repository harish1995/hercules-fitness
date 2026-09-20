import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MembershipDialog } from '../../components/memberships/MembershipDialog';
import { memberProfilePath } from '../../constants/routes';
import { diffIstDays, formatIstDate, todayIstStart } from '../../domain/dates';
import { PAGE_SIZE } from '../../domain/memberQueryPlan';
import { formatInr } from '../../domain/money';
import { EXPIRING_SOON_MAX_DAYS } from '../../domain/status';
import { useActor } from '../../hooks/useActor';
import { usePagedList } from '../../hooks/usePagedList';
import { toUserMessage } from '../../services/errors';
import { listExpiringMembers } from '../../services/memberService';
import { type Member } from '../../types/member';

/** The window choices (US-3.9): N lists members with 0 <= daysRemaining <= N. */
const EXPIRING_WINDOWS = [1, 3, 7, 15] as const;

/**
 * Memberships expiring soon (US-3.9, AC-17): not suspended, by each member's LATEST end date (so a member who already
 * renewed early is not listed), soonest first, cursor-paginated. Windows above 7 days list members whose badge is still
 * Active (documented, not a bug). The unpaid amount is the member's denormalized dues across their memberships (`pendingPaise`,
 * kept exact by every payment / void transaction, Phase 4). Renew is Admin only.
 */
export function ExpiringMembersPage() {
  const actor = useActor();
  const canRenew = actor?.role === 'ADMIN';
  const [days, setDays] = useState<number>(EXPIRING_SOON_MAX_DAYS);
  const today = todayIstStart();
  const list = usePagedList<Member>((cursor) => listExpiringMembers(days, cursor, today), `expiring:${days}:${today.getTime()}`);
  const [renewing, setRenewing] = useState<Member | null>(null);

  return (
    <>
      <PageHeader
        title="Expiring soon"
        subtitle="Members whose membership ends within the window, soonest first"
        actions={
          <TextField select size="small" label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 160 }}>
            {EXPIRING_WINDOWS.map((d) => (
              <MenuItem key={d} value={d}>
                {d === 1 ? 'Today and tomorrow' : `Next ${d} days`}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      {days > EXPIRING_SOON_MAX_DAYS && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Members expiring in {EXPIRING_SOON_MAX_DAYS + 1} to {days} days still have an Active badge: they are listed so you can chase early renewals.
        </Alert>
      )}

      {list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label="Loading…" />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load this list" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState title="Nothing expiring in this window" description="No active member's membership ends within this window." />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Memberships expiring soon" sx={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Member</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Expiry date</TableCell>
                  <TableCell align="right">Days remaining</TableCell>
                  <TableCell align="right">Unpaid amount</TableCell>
                  {canRenew && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {list.items.map((m) => {
                  const end = m.membership.endDate;
                  return (
                    <TableRow key={m.id} hover>
                      <TableCell>
                        <RouterLink to={memberProfilePath(m.id)}>{m.displayName}</RouterLink>
                        <br />
                        <span style={{ fontSize: 12, opacity: 0.7 }}>{m.memberId}</span>
                      </TableCell>
                      <TableCell>{m.mobile}</TableCell>
                      <TableCell>{m.membership.planName ?? '—'}</TableCell>
                      <TableCell>{end ? formatIstDate(end) : '—'}</TableCell>
                      <TableCell align="right">{end ? diffIstDays(today, end) : '—'}</TableCell>
                      <TableCell align="right">{formatInr(m.pendingPaise)}</TableCell>
                      {canRenew && (
                        <TableCell align="right">
                          <Button size="small" variant="outlined" onClick={() => setRenewing(m)}>
                            Renew
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
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
    </>
  );
}
