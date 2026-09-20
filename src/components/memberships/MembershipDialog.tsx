import {
  Alert,
  Box,
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
import { formatIstDate, parseDayInput, toDayInputValue, todayIstStart } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { computeEndDate, computeRenewalStart, formatPlanDuration } from '../../domain/renewal';
import { emptyPaymentForm, validatePaymentForm, type PaymentFieldErrors, type PaymentFormValues } from '../../domain/validation/payment';
import { useActor } from '../../hooks/useActor';
import { usePlans } from '../../hooks/usePlans';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { assignMembership, generateMembershipDocId, renewMembership } from '../../services/membershipService';
import { type Member } from '../../types/member';
import { type AssignedMembership } from '../../types/membership';
import { PaymentFields } from '../payments/PaymentFields';

interface MembershipDialogProps {
  mode: 'assign' | 'renew';
  member: Member;
  onClose: () => void;
  /** Called after a successful commit (the caller reloads its data). */
  onDone: (result: AssignedMembership) => void;
}

/**
 * Assign the first plan (US-3.5a) or renew (US-3.6). The dates shown are a PREVIEW from what was loaded: the real start
 * and end are recalculated inside the transaction at submit time from the freshly read latest end date, and the success
 * message reports the FINAL dates (US-3.6f). A membership id is generated once per dialog, so a double click or a retry
 * after a commit that actually succeeded creates only one membership (US-3.7b). An optional FIRST PAYMENT (US-4.2) is written in
 * the same transaction: Total Amount is the plan price, Amount Paid 0 / blank records no payment.
 */
export function MembershipDialog({ mode, member, onClose, onDone }: MembershipDialogProps) {
  const actor = useActor();
  const toast = useToast();
  const plans = usePlans();
  const [membershipDocId] = useState(() => generateMembershipDocId());
  const active = useMemo(() => (plans.data ?? []).filter((p) => p.active), [plans.data]);

  const previous = member.membership.planId;
  const previousIsActive = previous !== null && active.some((p) => p.id === previous);
  const [chosen, setChosen] = useState<string | null>(null);
  // renew defaults to the previous plan when it is still active (US-3.2c); otherwise the admin must pick one
  const planId = chosen ?? (mode === 'renew' && previousIsActive ? previous : '');
  const plan = active.find((p) => p.id === planId) ?? null;

  const [startInput, setStartInput] = useState(toDayInputValue(todayIstStart()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentFormValues>(() => emptyPaymentForm());
  const [paymentErrors, setPaymentErrors] = useState<PaymentFieldErrors>({});

  const today = todayIstStart();
  const assignStart = parseDayInput(startInput);
  const previewStart = mode === 'assign' ? assignStart : computeRenewalStart(member.membership.endDate, today);
  const previewEnd = plan && previewStart ? computeEndDate(previewStart, plan.durationValue, plan.durationUnit) : null;

  const blocked = mode === 'renew' && member.suspended;
  const canSubmit = !busy && !blocked && plan !== null && (mode === 'renew' || assignStart !== null);
  const verb = mode === 'assign' ? 'Assign plan' : 'Renew membership';

  async function submit() {
    if (!actor || !plan) return;
    // Amount Paid 0 / blank = no payment; otherwise mode + date are required and the amount may not exceed the total (US-4.2)
    const checked = validatePaymentForm(payment, { capPaise: plan.pricePaise, required: false });
    setPaymentErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return;
    const firstPayment = checked.details ?? undefined;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'assign' && assignStart
          ? await assignMembership({ memberDocId: member.id, planId: plan.id, membershipDocId, startDate: assignStart, actor, ...(firstPayment ? { firstPayment } : {}) })
          : await renewMembership({ memberDocId: member.id, planId: plan.id, membershipDocId, actor, ...(firstPayment ? { firstPayment } : {}) });
      const dates = `${formatIstDate(result.startDate)} to ${formatIstDate(result.endDate)}`;
      toast.success(
        result.alreadyExisted
          ? `This membership was already saved (${dates}).`
          : `${mode === 'assign' ? 'Plan assigned' : 'Membership renewed'} (${result.planName}): ${dates}.${
              result.paidPaise > 0 ? ` Paid ${formatInr(result.paidPaise)}, pending ${formatInr(result.amountPaise - result.paidPaise)}.` : ''
            }`,
      );
      onDone(result);
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="membership-dialog-title">
      <DialogTitle id="membership-dialog-title">
        {verb}: {member.displayName}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {blocked && <Alert severity="warning">This member is suspended. Reactivate the member before renewing.</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {plans.status === 'error' ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={plans.reload}>Retry</Button>}>
              {toUserMessage(plans.error)}
            </Alert>
          ) : plans.status === 'loading' && !plans.data ? (
            <CircularProgress size={24} aria-label="Loading plans" />
          ) : (
            <>
              <TextField
                select
                label="Plan *"
                value={planId}
                onChange={(e) => setChosen(e.target.value)}
                disabled={busy || blocked}
                helperText={
                  active.length === 0
                    ? 'There are no active plans. Create or activate one on the Membership Plans page.'
                    : mode === 'renew' && previous !== null && !previousIsActive
                      ? `The previous plan (${member.membership.planName ?? 'unknown'}) is inactive. Choose an active plan.`
                      : undefined
                }
              >
                {active.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} · {formatPlanDuration(p.durationValue, p.durationUnit)} · {formatInr(p.pricePaise)}
                  </MenuItem>
                ))}
              </TextField>
              {mode === 'assign' && (
                <TextField
                  label="Start date *"
                  type="date"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  disabled={busy}
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={assignStart === null}
                  helperText={assignStart === null ? 'Enter a valid date' : 'Any date is accepted (for example when onboarding an existing member)'}
                />
              )}
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }} aria-label="Membership preview">
                <Typography variant="body2">
                  Start: <strong>{previewStart ? formatIstDate(previewStart) : '—'}</strong>
                </Typography>
                <Typography variant="body2">
                  End: <strong>{previewEnd ? formatIstDate(previewEnd) : '—'}</strong>
                </Typography>
                <Typography variant="body2">
                  Total amount: <strong>{plan ? formatInr(plan.pricePaise) : '—'}</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  {mode === 'renew'
                    ? 'The final dates are calculated when you confirm, from the latest end date at that moment. '
                    : ''}
                  Take a first payment below, or leave it blank and the membership starts unpaid.
                </Typography>
              </Box>
              {plan && (
                <Box component="section" aria-label="Payment">
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Payment (optional)
                  </Typography>
                  <Stack spacing={2}>
                    <PaymentFields
                      values={payment}
                      errors={paymentErrors}
                      onChange={(patch) => {
                        setPayment((p) => ({ ...p, ...patch }));
                        setPaymentErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
                      }}
                      disabled={busy || blocked}
                      totalPaise={plan.pricePaise}
                    />
                  </Stack>
                </Box>
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
          disabled={!canSubmit}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {mode === 'assign' ? 'Assign plan' : 'Renew'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
