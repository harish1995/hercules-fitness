import { Box, Button, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { PagerBar } from '../../components/common/PagerBar';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { PaymentsTable } from '../../components/payments/PaymentsTable';
import { VoidPaymentDialog } from '../../components/payments/VoidPaymentDialog';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, isPaymentMethod } from '../../constants/enums';
import { ROUTES } from '../../constants/routes';
import { parseDayInput } from '../../domain/dates';
import { PAYMENT_PAGE_SIZE } from '../../domain/paymentQueryPlans';
import { usePagedList } from '../../hooks/usePagedList';
import { toUserMessage } from '../../services/errors';
import { listPayments } from '../../services/paymentService';
import { type Payment, type PaymentListFilter } from '../../types/payment';

/**
 * Payments (Admin, US-4.4c): every payment across members, newest payment date first, server-side cursor pagination (25 per
 * page). Filters are the ones the architecture indexes: an inclusive IST date range, a method, and Active vs Voided. Voided
 * payments are excluded from the default list (and from every total); the "Voided" view shows them, marked. No edit or delete.
 */
export function PaymentsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState('');
  const [view, setView] = useState<'ACTIVE' | 'VOIDED'>('ACTIVE');

  const fromDate = parseDayInput(from);
  const toDate = parseDayInput(to);
  const rangeInvalid = fromDate !== null && toDate !== null && fromDate.getTime() > toDate.getTime();
  const filter: PaymentListFilter = { from: fromDate, to: toDate, method: isPaymentMethod(method) ? method : null, voided: view === 'VOIDED' };
  const key = `payments:${view}:${filter.method ?? ''}:${fromDate?.getTime() ?? ''}:${toDate?.getTime() ?? ''}`;
  const list = usePagedList<Payment>((cursor) => (rangeInvalid ? Promise.resolve({ items: [], next: null }) : listPayments(filter, cursor)), key);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const filtered = view === 'VOIDED' || filter.method !== null || fromDate !== null || toDate !== null;

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Newest payment date first. Voided payments are excluded from totals and revenue."
        actions={
          <Button component={RouterLink} to={ROUTES.paymentsPending} variant="outlined">
            Pending payments
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="Paid from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Paid to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={rangeInvalid}
            helperText={rangeInvalid ? 'The end date is before the start date' : 'Inclusive whole days (IST)'}
            sx={{ flex: 1 }}
          />
          <TextField select label="Payment mode" value={method} onChange={(e) => setMethod(e.target.value)} sx={{ flex: 1 }}>
            <MenuItem value="">All modes</MenuItem>
            {PAYMENT_METHODS.map((m) => (
              <MenuItem key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Show" value={view} onChange={(e) => setView(e.target.value === 'VOIDED' ? 'VOIDED' : 'ACTIVE')} sx={{ flex: 1 }}>
            <MenuItem value="ACTIVE">Payments</MenuItem>
            <MenuItem value="VOIDED">Voided payments only</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {rangeInvalid ? (
        <EmptyState title="Check the dates" description="The end date is before the start date." />
      ) : list.status === 'loading' && list.items.length === 0 ? (
        <LoadingState label="Loading payments…" />
      ) : list.status === 'error' ? (
        <ErrorState title="Could not load payments" message={toUserMessage(list.error)} onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        filtered ? (
          <EmptyState title="No payments found" description="No payment matches these filters." />
        ) : (
          <EmptyState title="No payments yet" description="Payments recorded from a member's profile, the registration form or renewals appear here." />
        )
      ) : (
        <Paper variant="outlined">
          <Box>
            <PaymentsTable payments={list.items} showMember label="Payments" dim={list.status === 'loading'} onVoid={setVoiding} />
          </Box>
          <PagerBar list={list} pageSize={PAYMENT_PAGE_SIZE} />
        </Paper>
      )}

      {voiding && (
        <VoidPaymentDialog
          payment={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}
