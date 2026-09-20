import { Box, MenuItem, TextField } from '@mui/material';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '../../constants/enums';
import { formatInr } from '../../domain/money';
import { PAYMENT_NOTES_MAX, PAYMENT_REFERENCE_MAX } from '../../domain/payment';
import { pendingPreviewPaise, type PaymentFieldErrors, type PaymentFormValues } from '../../domain/validation/payment';

interface PaymentFieldsProps {
  values: PaymentFormValues;
  errors: PaymentFieldErrors;
  onChange: (patch: Partial<PaymentFormValues>) => void;
  disabled?: boolean;
  /**
   * The Total Amount of the membership (the plan price snapshot, read-only). When given, the read-only Total Amount and the
   * computed Pending amount are shown (display only: never typed, never stored, US-4.2a).
   */
  totalPaise?: number;
  /** Label of the amount input. */
  amountLabel?: string;
  amountHelper?: string;
  onBlurAmount?: () => void;
}

/**
 * The payment inputs shared by the registration form, the renew / assign dialog and the record-payment dialog: Amount Paid,
 * computed Pending, Payment Date, Payment Mode, Transaction Reference, Notes. There is deliberately NO card number, expiry or
 * CVV input, and the reference / notes fields refuse text that looks like a card number (PCI-DSS scope is avoided: only the
 * mode and a reference are recorded).
 */
export function PaymentFields({ values, errors, onChange, disabled, totalPaise, amountLabel = 'Amount paid', amountHelper, onBlurAmount }: PaymentFieldsProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      {totalPaise !== undefined && (
        <TextField
          label="Total amount"
          value={formatInr(totalPaise)}
          disabled
          slotProps={{ input: { readOnly: true } }}
          helperText="The plan price"
        />
      )}
      <TextField
        label={amountLabel}
        value={values.paymentAmount}
        onChange={(e) => onChange({ paymentAmount: e.target.value })}
        onBlur={onBlurAmount}
        disabled={disabled}
        error={Boolean(errors.paymentAmount)}
        helperText={errors.paymentAmount ?? amountHelper ?? 'In rupees, up to 2 decimals'}
        slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
      />
      {totalPaise !== undefined && (
        <TextField
          label="Pending amount"
          value={formatInr(pendingPreviewPaise(totalPaise, values.paymentAmount))}
          disabled
          slotProps={{ input: { readOnly: true } }}
          helperText="Calculated: total minus amount paid"
        />
      )}
      <TextField
        label="Payment date"
        type="date"
        value={values.paymentDate}
        onChange={(e) => onChange({ paymentDate: e.target.value })}
        disabled={disabled}
        error={Boolean(errors.paymentDate)}
        helperText={errors.paymentDate ?? 'Today or an earlier day'}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        select
        label="Payment mode"
        value={values.paymentMethod}
        onChange={(e) => onChange({ paymentMethod: e.target.value })}
        disabled={disabled}
        error={Boolean(errors.paymentMethod)}
        helperText={errors.paymentMethod}
      >
        {PAYMENT_METHODS.map((m) => (
          <MenuItem key={m} value={m}>
            {PAYMENT_METHOD_LABELS[m]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Transaction reference"
        value={values.paymentReference}
        onChange={(e) => onChange({ paymentReference: e.target.value })}
        disabled={disabled}
        error={Boolean(errors.paymentReference)}
        helperText={errors.paymentReference ?? 'Optional: UPI / bank / receipt reference. Never a card number.'}
        slotProps={{ htmlInput: { maxLength: PAYMENT_REFERENCE_MAX, autoComplete: 'off' } }}
      />
      <TextField
        label="Notes"
        value={values.paymentNotes}
        onChange={(e) => onChange({ paymentNotes: e.target.value })}
        disabled={disabled}
        error={Boolean(errors.paymentNotes)}
        helperText={errors.paymentNotes ?? 'Optional'}
        slotProps={{ htmlInput: { maxLength: PAYMENT_NOTES_MAX } }}
      />
    </Box>
  );
}
