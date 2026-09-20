import {
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import { useActor } from '../../hooks/useActor';
import { usePagedList } from '../../hooks/usePagedList';
import { toUserMessage } from '../../services/errors';
import { listExpiredMembers } from '../../services/memberService';
import { type Member } from '../../types/member';

/**
 * Expired members (US-3.10): latest end date before today (an end date of today is still valid), not suspended, most
 * recently expired first, cursor-paginated. "Previous plan / amount" are the member's latest membership. Renew is Admin only.
 */
export function ExpiredMembersPage() {
  const actor = useActor();
  const canRenew = actor?.role === 'ADMIN';
  const today = todayIstStart();
  const list = usePagedList<Member>((cursor) => listExpiredMembers(cursor, today), `expired:${today.getTime()}`);
  const [renewing, setRenewing] = useState<Member | null>(null);

  return (
    <>
      <PageHeader title="Expired members" subtitle="Most recently expired first" />
      {list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label="Loading…" />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load this list" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState title="No expired members" description="Every member with a membership is still valid, suspended, or has no membership." />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Expired members" sx={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Member</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell>Previous plan</TableCell>
                  <TableCell>Expired on</TableCell>
                  <TableCell align="right">Days since expiry</TableCell>
                  <TableCell align="right">Previous amount</TableCell>
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
                      <TableCell align="right">{end ? -diffIstDays(today, end) : '—'}</TableCell>
                      <TableCell align="right">{m.membership.amountPaise !== null ? formatInr(m.membership.amountPaise) : '—'}</TableCell>
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
