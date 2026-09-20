import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { formatIstDate } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { emptyPaymentForm, toRupeeInput, validatePaymentForm, type PaymentFieldErrors, type PaymentFormValues } from '../../domain/validation/payment';
import { useActor } from '../../hooks/useActor';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { generatePaymentDocId, listUnpaidMemberships, recordPayment } from '../../services/paymentService';
import { type Member } from '../../types/member';
import { type RecordedPayment } from '../../types/payment';
import { PaymentFields } from './PaymentFields';

interface RecordPaymentDialogProps {
  member: Pick<Member, 'id' | 'displayName' | 'memberId'>;
  /** Preselect this membership (must still owe money); default = the OLDEST membership with an outstanding balance. */
  membershipId?: string;
  onClose: () => void;
  /** Called after a successful commit (the caller reloads its data). */
  onDone: (result: RecordedPayment) => void;
}

/**
 * Record a payment (TX-4, US-4.1). The Admin picks the membership the money is for (default = the oldest that still owes;
 * never split or allocated automatically, NEW-10). The amount is checked against that membership's balance here and again,
 * against the freshly read balance, inside the transaction. The payment id is generated once per dialog, so a double click or a
 * retry after a commit that actually succeeded records only one payment (US-4.1h).
 */
export function RecordPaymentDialog({ member, membershipId, onClose, onDone }: RecordPaymentDialogProps) {
  const actor = useActor();
  const toast = useToast();
  const [paymentDocId] = useState(() => generatePaymentDocId());
  const unpaid = useAsyncData(() => listUnpaidMemberships(member.id), `unpaid:${member.id}`);
  const options = useMemo(() => unpaid.data ?? [], [unpaid.data]);

  const [chosen, setChosen] = useState<string | null>(null);
  const selectedId = chosen ?? (membershipId && options.some((m) => m.id === membershipId) ? membershipId : (options[0]?.id ?? ''));
  const selected = options.find((m) => m.id === selectedId) ?? null;

  const [values, setValues] = useState<PaymentFormValues>(() => emptyPaymentForm());
  const [errors, setErrors] = useState<PaymentFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!actor || !selected) return;
    const checked = validatePaymentForm(values, { capPaise: selected.outstandingPaise, required: true });
    setErrors(checked.errors);
    if (!checked.details) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordPayment({
        paymentDocId, memberDocId: member.id, membershipId: selected.id, details: checked.details, actor,
      });
      toast.success(
        result.alreadyExisted
          ? 'This payment was already recorded.'
          : `Payment of ${formatInr(result.amountPaise)} recorded. ${
              result.outstandingPaise === 0 ? 'This membership is fully paid.' : `Still pending on this membership: ${formatInr(result.outstandingPaise)}.`
            }`,
      );
      onDone(result);
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="record-payment-title">
      <DialogTitle id="record-payment-title">
        Record payment: {member.displayName} ({member.memberId})
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {unpaid.status === 'error' ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={unpaid.reload}>Retry</Button>}>
              {toUserMessage(unpaid.error)}
            </Alert>
          ) : unpaid.status === 'loading' && !unpaid.data ? (
            <CircularProgress size={24} aria-label="Loading memberships" />
          ) : options.length === 0 ? (
            <Alert severity="info">This member has nothing pending: every membership is fully paid.</Alert>
          ) : (
            <>
              <TextField
                select
                label="Membership *"
                value={selectedId}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setErrors({});
                }}
                disabled={busy}
                helperText={options.length > 1 ? 'This member owes on several memberships. Payments are never split: choose one.' : undefined}
              >
                {options.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.planName} · {formatIstDate(m.startDate)} to {formatIstDate(m.endDate)} · pending {formatInr(m.outstandingPaise)}
                  </MenuItem>
                ))}
              </TextField>
              {selected && (
                <Typography variant="body2" aria-label="Membership balance">
                  Total {formatInr(selected.amountPaise)} · paid {formatInr(selected.paidPaise)} · pending{' '}
                  <strong>{formatInr(selected.outstandingPaise)}</strong>
                </Typography>
              )}
              <PaymentFields
                values={values}
                errors={errors}
                onChange={(patch) => {
                  setValues((v) => ({ ...v, ...patch }));
                  setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
                }}
                disabled={busy}
                amountLabel="Amount received *"
                amountHelper={selected ? `Up to ${formatInr(selected.outstandingPaise)} (the pending balance)` : undefined}
              />
              {selected && (
                <Button
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                  disabled={busy}
                  onClick={() => setValues((v) => ({ ...v, paymentAmount: toRupeeInput(selected.outstandingPaise) }))}
                >
                  Pay the full pending balance ({formatInr(selected.outstandingPaise)})
                </Button>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !selected}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Record payment
        </Button>
      </DialogActions>
    </Dialog>
  );
}
