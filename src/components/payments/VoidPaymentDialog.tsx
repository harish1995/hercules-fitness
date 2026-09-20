import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { PAYMENT_METHOD_LABELS } from '../../constants/enums';
import { formatIstDate } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { VOID_REASON_MAX, voidReasonError } from '../../domain/payment';
import { useActor } from '../../hooks/useActor';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { voidPayment } from '../../services/paymentService';
import { type Payment } from '../../types/payment';

interface VoidPaymentDialogProps {
  payment: Payment;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Void a payment (TX-5, NEW-9): a reason is required. The payment is NOT deleted: it stays in the history marked VOID, is
 * excluded from every total and from revenue, and the membership's and member's pending balances are restored in the same
 * atomic write. A void cannot be undone or edited.
 */
export function VoidPaymentDialog({ payment, onClose, onDone }: VoidPaymentDialogProps) {
  const actor = useActor();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = voidReasonError(reason);

  async function submit() {
    setTouched(true);
    if (!actor || problem) return;
    setBusy(true);
    setError(null);
    try {
      const result = await voidPayment({ paymentId: payment.id, reason, actor });
      toast.success(result.changed ? `Payment of ${formatInr(payment.amountPaise)} voided. The balance was restored.` : 'This payment was already voided.');
      onDone();
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="void-payment-title">
      <DialogTitle id="void-payment-title">Void this payment?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2">
            {formatInr(payment.amountPaise)} by {PAYMENT_METHOD_LABELS[payment.method]} on {formatIstDate(payment.paymentDate)} from{' '}
            {payment.memberDisplayName} ({payment.memberId}).
          </Typography>
          <Alert severity="warning">
            The payment stays in the history marked VOID and is excluded from totals and revenue. The amount becomes pending again on
            the membership. This cannot be undone.
          </Alert>
          <TextField
            label="Reason *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
            multiline
            minRows={2}
            error={touched && problem !== null}
            helperText={touched && problem ? problem : `Required. Up to ${VOID_REASON_MAX} characters. Do not enter card numbers.`}
            slotProps={{ htmlInput: { maxLength: VOID_REASON_MAX } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void submit()}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Void payment
        </Button>
      </DialogActions>
    </Dialog>
  );
}
