import { Button, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberStatusBadge } from '../../components/members/MemberStatusBadge';
import { RecordPaymentDialog } from '../../components/payments/RecordPaymentDialog';
import { memberProfilePath, ROUTES } from '../../constants/routes';
import { formatIstDate } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { PAYMENT_PAGE_SIZE } from '../../domain/paymentQueryPlans';
import { useAsyncData } from '../../hooks/useAsyncData';
import { usePagedList } from '../../hooks/usePagedList';
import { toUserMessage } from '../../services/errors';
import { getPendingPaymentTotals, listPendingMembers } from '../../services/paymentService';
import { type Member } from '../../types/member';

/**
 * Pending payments (Admin, US-4.5). Per the architecture (section 5.7) this is a MEMBER-level list: members who owe money
 * (`pendingPaise > 0`, not deleted), largest amount first, server-side cursor pagination, with the total from one aggregation.
 * (The requirements' default of filtering by membership start date is replaced by this design; "oldest first" is not offered
 * because it would need a per-membership query that includes deleted members.) Each row opens the record-payment dialog, which
 * lists that member's unpaid memberships.
 */
export function PendingPaymentsPage() {
  const list = usePagedList<Member>((cursor) => listPendingMembers(cursor), 'pending-members');
  const totals = useAsyncData(() => getPendingPaymentTotals(), 'pending-totals');
  const [paying, setPaying] = useState<Member | null>(null);

  return (
    <>
      <PageHeader
        title="Pending payments"
        subtitle={
          totals.data
            ? `${formatInr(totals.data.totalPaise)} pending across ${totals.data.memberCount} member${totals.data.memberCount === 1 ? '' : 's'}. Largest first.`
            : 'Members who owe money, largest amount first.'
        }
        actions={
          <Button component={RouterLink} to={ROUTES.payments} variant="outlined">
            All payments
          </Button>
        }
      />

      {list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label="Loading…" />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load pending payments" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState title="Nothing pending" description="Every member is fully paid." />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Pending payments" sx={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Member</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Expiry</TableCell>
                  <TableCell align="right">Pending</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.items.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell>
                      <RouterLink to={memberProfilePath(m.id)}>{m.displayName}</RouterLink>
                      <br />
                      <span style={{ fontSize: 12, opacity: 0.7 }}>{m.memberId}</span>
                    </TableCell>
                    <TableCell>{m.mobile}</TableCell>
                    <TableCell>
                      <MemberStatusBadge member={m} />
                    </TableCell>
                    <TableCell>{m.membership.endDate ? formatIstDate(m.membership.endDate) : '—'}</TableCell>
                    <TableCell align="right">
                      <Typography component="span" sx={{ fontWeight: 600 }}>
                        {formatInr(m.pendingPaise)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" onClick={() => setPaying(m)}>
                        Record payment
                      </Button>
                      <Button size="small" component={RouterLink} to={memberProfilePath(m.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <PagerBar list={list} pageSize={PAYMENT_PAGE_SIZE} />
        </Paper>
      )}

      {paying && (
        <RecordPaymentDialog
          member={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            list.reload();
            totals.reload();
          }}
        />
      )}
    </>
  );
}
