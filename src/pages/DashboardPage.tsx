import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { lazy, Suspense } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/dashboard/StatCard';
import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { memberProfilePath, ROUTES } from '../constants/routes';
import { diffIstDays, formatIstDate, todayIstStart } from '../domain/dates';
import { formatInr } from '../domain/money';
import { useAsyncData } from '../hooks/useAsyncData';
import { getAttendanceDashboardStats, getDashboardStats, getPaymentDashboardStats } from '../services/dashboardService';
import { toUserMessage } from '../services/errors';
import { type MemberListStatus } from '../types/member';

const NewMembersChart = lazy(() => import('../components/dashboard/NewMembersChart'));
const PlanDistributionChart = lazy(() => import('../components/dashboard/PlanDistributionChart'));
const AttendanceChart = lazy(() => import('../components/dashboard/AttendanceChart'));
const RevenueChart = lazy(() => import('../components/dashboard/RevenueChart'));

/** Each status card links to the members list filtered with the SAME predicate (FR-9). */
const listLink = (status: MemberListStatus) => `${ROUTES.members}?status=${status}`;

/**
 * Dashboard (US-2.12, US-3.12, US-4.5c, US-4.6): status cards (aggregation counts built from the same predicates as the list
 * filters), Pending payments and Current-month revenue cards plus the 12-month revenue chart (`sum` / `count` aggregations over
 * IST month boundaries, voided payments excluded), the plan distribution chart, the next-10-expiring table (a limited query) and
 * the new-members chart. Phase 5 adds Today's attendance, Currently checked in and the 12-month attendance chart (`count()` aggregations,
 * loaded separately like the money figures). Nothing reads a whole collection. Refresh recomputes "today" and every figure (US-3.12e). The money
 * figures load separately so a problem with one set (e.g. an index still building) never blanks the other.
 */
export function DashboardPage() {
  const stats = useAsyncData(() => getDashboardStats(), 'dashboard');
  const money = useAsyncData(() => getPaymentDashboardStats(), 'dashboard-money');
  const attendance = useAsyncData(() => getAttendanceDashboardStats(), 'dashboard-attendance');
  const data = stats.data;
  const attendanceValue = (n: number | undefined) => (n !== undefined ? n : attendance.status === 'loading' ? '…' : null);
  const pending = money.data?.pending;
  const moneyValue = <T,>(v: T | undefined, format: (x: T) => string) => (v !== undefined ? format(v) : money.status === 'loading' ? '…' : null);
  const currentMonth = money.data?.revenueByMonth[money.data.revenueByMonth.length - 1];
  const today = todayIstStart();
  const c = data?.statusCounts;
  const value = (n: number | undefined) => (n !== undefined ? n : stats.status === 'loading' ? '…' : null);
  const viewAll = (status: MemberListStatus) => (
    <Button size="small" component={RouterLink} to={listLink(status)}>
      View list
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <Button
            startIcon={<RefreshIcon />}
            variant="outlined"
            onClick={() => {
              stats.reload();
              money.reload();
              attendance.reload();
            }}
            disabled={stats.status === 'loading' || money.status === 'loading' || attendance.status === 'loading'}
          >
            Refresh
          </Button>
        }
      />

      {stats.status === 'error' ? (
        <ErrorState title="Could not load the dashboard" message={toUserMessage(stats.error)} onRetry={stats.reload} />
      ) : (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            <StatCard label="Total members" value={value(c?.total)} hint="Members that are not deleted" action={viewAll('ALL')} />
            <StatCard label="Active" value={value(c?.active)} hint="8 or more days left" action={viewAll('ACTIVE')} />
            <StatCard label="Expiring ≤ 7 days" value={value(c?.expiringSoon)} hint="0 to 7 days left" action={viewAll('EXPIRING_SOON')} />
            <StatCard label="Expired" value={value(c?.expired)} hint="Ended before today" action={viewAll('EXPIRED')} />
            <StatCard label="Suspended" value={value(c?.suspended)} hint="Flagged by an Admin" action={viewAll('SUSPENDED')} />
            <StatCard label="No membership" value={value(c?.noMembership)} hint="Total = the five statuses above" action={viewAll('NO_MEMBERSHIP')} />
            <StatCard
              label="Pending payments"
              value={moneyValue(pending?.totalPaise, formatInr)}
              hint={
                money.status === 'error'
                  ? toUserMessage(money.error)
                  : pending
                    ? `${pending.memberCount} member${pending.memberCount === 1 ? '' : 's'} owing`
                    : 'Total outstanding'
              }
              action={
                <Button size="small" component={RouterLink} to={ROUTES.paymentsPending}>
                  View list
                </Button>
              }
            />
            <StatCard
              label="Revenue this month"
              value={moneyValue(currentMonth?.totalPaise, formatInr)}
              hint={money.status === 'error' ? toUserMessage(money.error) : `${currentMonth?.label ?? 'This month'}: payments received (IST)`}
              action={
                money.status === 'error' ? (
                  <Button size="small" onClick={money.reload}>
                    Retry
                  </Button>
                ) : (
                  <Button size="small" component={RouterLink} to={ROUTES.payments}>
                    View payments
                  </Button>
                )
              }
            />
            <StatCard
              label="Today's attendance"
              value={attendanceValue(attendance.data?.todayPresent)}
              hint={attendance.status === 'error' ? toUserMessage(attendance.error) : 'Check-ins dated today (IST), including those already checked out'}
              action={
                attendance.status === 'error' ? (
                  <Button size="small" onClick={attendance.reload}>
                    Retry
                  </Button>
                ) : (
                  <Button size="small" component={RouterLink} to={ROUTES.attendance}>
                    View attendance
                  </Button>
                )
              }
            />
            <StatCard
              label="Currently checked in"
              value={attendanceValue(attendance.data?.currentlyCheckedIn)}
              hint={attendance.status === 'error' ? toUserMessage(attendance.error) : "Today's check-ins with no check-out; resets at midnight IST"}
              action={
                <Button size="small" component={RouterLink} to={ROUTES.attendance}>
                  View attendance
                </Button>
              }
            />
          </Box>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 3 }} component="section" aria-label="Memberships expiring soon">
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                Memberships expiring soon
              </Typography>
              <Button size="small" component={RouterLink} to={ROUTES.membersExpiring}>
                View all
              </Button>
            </Box>
            {!data ? (
              <LoadingState label="Loading…" />
            ) : data.nextExpiring.length === 0 ? (
              <EmptyState title="Nothing expiring in the next 7 days" />
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Next 10 expiring memberships">
                  <TableHead>
                    <TableRow>
                      <TableCell>Member</TableCell>
                      <TableCell>Plan</TableCell>
                      <TableCell>Expiry date</TableCell>
                      <TableCell align="right">Days remaining</TableCell>
                      <TableCell align="right">Unpaid amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.nextExpiring.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <RouterLink to={memberProfilePath(m.id)}>{m.displayName}</RouterLink>
                        </TableCell>
                        <TableCell>{m.membership.planName ?? '—'}</TableCell>
                        <TableCell>{m.membership.endDate ? formatIstDate(m.membership.endDate) : '—'}</TableCell>
                        <TableCell align="right">{m.membership.endDate ? diffIstDays(today, m.membership.endDate) : '—'}</TableCell>
                        <TableCell align="right">{formatInr(m.pendingPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          <Box sx={{ display: 'grid', gap: 3, mt: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
            <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Plan distribution">
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                Members per plan
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Active and expiring-soon memberships, by plan
              </Typography>
              {!data ? (
                <LoadingState label="Loading…" />
              ) : data.planDistribution.length === 0 ? (
                <EmptyState title="No active memberships yet" />
              ) : (
                <Suspense fallback={<LoadingState label="Loading chart…" />}>
                  <PlanDistributionChart entries={data.planDistribution} />
                </Suspense>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Revenue by month">
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                Revenue by month
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Payments received by payment date, last 12 months (IST); voided payments excluded
              </Typography>
              {money.status === 'error' ? (
                <ErrorState title="Could not load revenue" message={toUserMessage(money.error)} onRetry={money.reload} />
              ) : money.data ? (
                <Suspense fallback={<LoadingState label="Loading chart…" />}>
                  <RevenueChart months={money.data.revenueByMonth} />
                </Suspense>
              ) : (
                <LoadingState label="Loading…" />
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Attendance by month">
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                Attendance by month
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Check-ins (present records) by attendance date, last 12 months (IST)
              </Typography>
              {attendance.status === 'error' ? (
                <ErrorState title="Could not load attendance" message={toUserMessage(attendance.error)} onRetry={attendance.reload} />
              ) : attendance.data ? (
                <Suspense fallback={<LoadingState label="Loading chart…" />}>
                  <AttendanceChart months={attendance.data.byMonth} />
                </Suspense>
              ) : (
                <LoadingState label="Loading…" />
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="New members by month">
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                New members by month
              </Typography>
              <Typography variant="caption" color="text.secondary">
                By joining date, last 12 months (IST)
              </Typography>
              {data ? (
                <Suspense fallback={<LoadingState label="Loading chart…" />}>
                  <NewMembersChart months={data.newMembersByMonth} />
                </Suspense>
              ) : (
                <LoadingState label="Loading…" />
              )}
            </Paper>
          </Box>
        </>
      )}
    </>
  );
}
