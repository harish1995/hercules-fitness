import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link as RouterLink } from 'react-router-dom';
import { CONSENT_TEXT_ADULT, CONSENT_TEXT_GUARDIAN } from '../../constants/consent';
import { GENDER_LABELS, GENDERS } from '../../constants/enums';
import { ROUTES } from '../../constants/routes';
import { ageOnIstDate, formatIstDate, parseDayInput, systemClock } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { computeEndDate, formatPlanDuration } from '../../domain/renewal';
import { normalizeMobile } from '../../domain/search';
import { buildMemberFormSchema, NOTES_MAX, type MemberFormMode, type MemberFormValues } from '../../domain/validation/member';
import { type PaymentFieldErrors, type PaymentFormValues } from '../../domain/validation/payment';
import { DuplicateMobileError, mapFirebaseError } from '../../services/errors';
import { type DuplicateMemberInfo, type Trainer } from '../../types/member';
import { type Plan } from '../../types/membership';
import { PaymentFields } from '../payments/PaymentFields';

interface MemberFormProps {
  mode: MemberFormMode;
  defaultValues: MemberFormValues;
  /** Trainers to choose from (the page passes the active ones plus the member's current trainer). */
  trainers: Trainer[];
  /** Medical notes are Admin-only: STAFF never gets the field (US-2.6b). */
  canEditMedical: boolean;
  /** The member being edited (its own mobile is not a duplicate). */
  ownMemberDocId?: string;
  /**
   * `duplicateMobileConfirmed` is true when the user ticked "register anyway" for a mobile another member already has
   * (NEW-14: a warning that needs an explicit confirmation, never a hard block). The edit path passes it too.
   */
  onSubmit: (values: MemberFormValues, options: { duplicateMobileConfirmed: boolean }) => Promise<void>;
  onCancel: () => void;
  /** Live duplicate-mobile lookup (US-2.3): the member to name in the warning, live ones first. Best effort. */
  checkMobile: (mobile: string) => Promise<DuplicateMemberInfo | null>;
  /**
   * The ACTIVE plans an Admin can assign at registration (US-3.5b). Undefined = no membership section (Staff, or edit):
   * assigning a plan involves money, so it is Admin-only (permission matrix).
   */
  plans?: Plan[];
  /** Photo picker (registration only). */
  photoSlot?: ReactNode;
  /** After a CONFLICT (US-2.10d) the page can reload the record. */
  onReload?: () => void;
  submitLabel: string;
  loadingNotice?: ReactNode;
}

const errorText = (e: { message?: string } | undefined) => e?.message;

/**
 * The member registration / edit form (React Hook Form + Zod, US-2.4). An Admin can also choose a plan and start date,
 * which creates the first membership atomically with the member (US-3.5b), and optionally take the first payment in the same
 * step (US-4.2): Total Amount (the plan price), Amount Paid, a computed Pending (display only), Payment Date, Mode, Reference.
 * The submit button is disabled while a submit is in flight (US-2.1d). On any failure the entered values are kept and
 * a retryable message is shown (US-2.1c). A duplicate mobile is a WARNING that gates submit behind an explicit
 * "register anyway" confirmation (NEW-14).
 */
export function MemberForm({
  mode,
  defaultValues,
  trainers,
  canEditMedical,
  ownMemberDocId,
  onSubmit,
  onCancel,
  checkMobile,
  plans,
  photoSlot,
  onReload,
  submitLabel,
}: MemberFormProps) {
  // the first payment is checked against the plan price, so the schema needs the prices of the plans on offer
  const priceKey = plans?.map((p) => `${p.id}:${p.pricePaise}`).join('|') ?? '';
  const schema = useMemo(
    () => buildMemberFormSchema(mode, systemClock, plans ? Object.fromEntries(plans.map((p) => [p.id, p.pricePaise])) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `priceKey` captures exactly what the schema reads from `plans`
    [mode, priceKey],
  );
  const {
    control,
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({ resolver: zodResolver(schema), defaultValues, mode: 'onTouched' });

  const [duplicate, setDuplicate] = useState<DuplicateMemberInfo | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [formError, setFormError] = useState<{ message: string; conflict: boolean } | null>(null);
  // editing: the member's OWN, unchanged number is never a duplicate warning
  const originalMobile = mode === 'edit' ? normalizeMobile(defaultValues.mobile) : null;
  // a soft-deleted owner is named but never stops (or gates) the submit (US-2.3c)
  const gatesSubmit = duplicate !== null && !duplicate.deleted;

  const dob = useWatch({ control, name: 'dateOfBirth' });
  const planId = useWatch({ control, name: 'planId' });
  const membershipStart = useWatch({ control, name: 'membershipStart' });
  const chosenPlan = plans?.find((p) => p.id === planId) ?? null;
  const paymentValues = useWatch({ control, name: ['paymentAmount', 'paymentDate', 'paymentMethod', 'paymentReference', 'paymentNotes'] });
  const payment: PaymentFormValues = {
    paymentAmount: paymentValues[0], paymentDate: paymentValues[1], paymentMethod: paymentValues[2],
    paymentReference: paymentValues[3], paymentNotes: paymentValues[4],
  };
  const paymentErrors: PaymentFieldErrors = {
    paymentAmount: errors.paymentAmount?.message, paymentDate: errors.paymentDate?.message, paymentMethod: errors.paymentMethod?.message,
    paymentReference: errors.paymentReference?.message, paymentNotes: errors.paymentNotes?.message,
  };
  const startDate = parseDayInput(membershipStart);
  const endPreview = chosenPlan && startDate ? computeEndDate(startDate, chosenPlan.durationValue, chosenPlan.durationUnit) : null;
  const dobDate = parseDayInput(dob);
  const under18 = dobDate !== null && dobDate.getTime() <= systemClock().getTime() && ageOnIstDate(dobDate, systemClock()) < 18;

  const lookupMobile = useCallback(
    async (raw: string) => {
      const mobile = normalizeMobile(raw);
      let found: DuplicateMemberInfo | null = null;
      if (mobile && mobile !== originalMobile) {
        try {
          const owner = await checkMobile(mobile);
          found = owner && owner.memberDocId !== ownMemberDocId ? owner : null;
        } catch {
          found = null; // a failed lookup never nags or blocks: the save path checks again
        }
      }
      setDuplicate((prev) => {
        if (prev?.memberDocId !== found?.memberDocId) setDuplicateConfirmed(false); // a different owner needs a fresh confirmation
        return found;
      });
    },
    [checkMobile, ownMemberDocId, originalMobile],
  );

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values, { duplicateMobileConfirmed: duplicateConfirmed });
    } catch (e) {
      if (e instanceof DuplicateMobileError) {
        // the save-time check found a live owner the blur lookup did not: warn, and ask for the explicit confirmation
        setDuplicate(e.existing ?? { memberDocId: '', memberId: '', displayName: 'another member', deleted: false });
        setDuplicateConfirmed(false);
        return;
      }
      const err = mapFirebaseError(e);
      setFormError({ message: err.userMessage, conflict: err.kind === 'CONFLICT' });
    }
  });

  const changePayment = (patch: Partial<PaymentFormValues>) => {
    for (const [key, value] of Object.entries(patch) as [keyof PaymentFormValues, string][]) {
      // re-validate while typing only a field that already shows an error, so it clears as soon as it is fixed
      setValue(key, value, { shouldDirty: true, shouldValidate: Boolean(errors[key]) });
    }
  };

  const field = (name: keyof MemberFormValues, label: string, extra: Record<string, unknown> = {}) => (
    <TextField
      label={label}
      {...register(name as Exclude<keyof MemberFormValues, 'consent'>)}
      error={Boolean(errors[name])}
      helperText={errorText(errors[name])}
      disabled={isSubmitting}
      {...extra}
    />
  );
  const dateProps = { type: 'date', slotProps: { inputLabel: { shrink: true } } };

  return (
    <Box component="form" noValidate onSubmit={(e) => void submit(e)} aria-label={mode === 'create' ? 'Register member' : 'Edit member'}>
      <Stack spacing={3}>
        {formError && (
          <Alert
            severity="error"
            role="alert"
            action={
              formError.conflict && onReload ? (
                <Button color="inherit" size="small" onClick={onReload}>
                  Reload record
                </Button>
              ) : undefined
            }
          >
            {formError.message}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Personal details
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {field('firstName', 'First name *', { autoComplete: 'off' })}
            {field('lastName', 'Last name *', { autoComplete: 'off' })}
            <Controller
              control={control}
              name="gender"
              render={({ field: f }) => (
                <TextField
                  select
                  label="Gender *"
                  {...f}
                  error={Boolean(errors.gender)}
                  helperText={errorText(errors.gender)}
                  disabled={isSubmitting}
                >
                  {GENDERS.map((g) => (
                    <MenuItem key={g} value={g}>
                      {GENDER_LABELS[g]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            {field('dateOfBirth', 'Date of birth *', dateProps)}
            <Box>
              <TextField
                label="Mobile *"
                placeholder="10-digit mobile, e.g. 9876543210"
                {...register('mobile', { onBlur: (e) => void lookupMobile(String(e.target.value)) })}
                error={Boolean(errors.mobile)}
                helperText={errorText(errors.mobile)}
                disabled={isSubmitting}
                slotProps={{ htmlInput: { inputMode: 'tel' } }}
              />
              {duplicate && duplicate.deleted && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  This mobile number belonged to a deleted member ({duplicate.displayName}, {duplicate.memberId}). You can continue.
                </Alert>
              )}
              {duplicate && !duplicate.deleted && (
                <Alert severity="warning" role="alert" sx={{ mt: 1 }}>
                  This mobile number is already registered to{' '}
                  {duplicate.memberDocId ? (
                    <RouterLink to={`${ROUTES.members}/${duplicate.memberDocId}`}>
                      {duplicate.displayName} ({duplicate.memberId})
                    </RouterLink>
                  ) : (
                    duplicate.displayName
                  )}
                  . Families can share a phone, so this is only a warning.
                  <FormControlLabel
                    sx={{ display: 'block', mt: 0.5 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={duplicateConfirmed}
                        onChange={(e) => setDuplicateConfirmed(e.target.checked)}
                        disabled={isSubmitting}
                      />
                    }
                    label={mode === 'create' ? 'Register anyway: this is a different person' : 'Save anyway: this is a different person'}
                  />
                </Alert>
              )}
            </Box>
            {field('email', 'Email', { type: 'email', autoComplete: 'off' })}
            <Box sx={{ gridColumn: { md: '1 / -1' } }}>{field('address', 'Address', { multiline: true, minRows: 2 })}</Box>
            {field('joiningDate', 'Joining date *', dateProps)}
            <Controller
              control={control}
              name="trainerId"
              render={({ field: f }) => (
                <TextField select label="Trainer" {...f} disabled={isSubmitting} helperText="Optional">
                  <MenuItem value="">None</MenuItem>
                  {trainers.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                      {t.active ? '' : ' (inactive)'}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Box>
          {photoSlot && <Box sx={{ mt: 2 }}>{photoSlot}</Box>}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {under18 ? 'Guardian details *' : 'Emergency contact'}
          </Typography>
          {under18 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Under 18: the guardian&apos;s name and mobile number are required, and consent is given by the guardian.
            </Alert>
          )}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {field('emergencyName', under18 ? 'Guardian name *' : 'Name')}
            {field('emergencyMobile', under18 ? 'Guardian mobile *' : 'Mobile', { slotProps: { htmlInput: { inputMode: 'tel' } } })}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Notes
          </Typography>
          <Stack spacing={2}>
            {field('generalNotes', 'General notes', { multiline: true, minRows: 2, helperText: errorText(errors.generalNotes) ?? `Up to ${NOTES_MAX} characters` })}
            {canEditMedical && (
              <TextField
                label="Medical notes (Admin only)"
                {...register('medicalNotes')}
                multiline
                minRows={2}
                error={Boolean(errors.medicalNotes)}
                helperText={errorText(errors.medicalNotes) ?? 'Health information. Visible to Admin only; never shown to Staff or exported.'}
                disabled={isSubmitting}
              />
            )}
          </Stack>
        </Paper>

        {mode === 'create' && plans && (
          <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Membership">
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              Membership (optional)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Choose a plan to create the member&apos;s first membership together with the member. The end date and the total
              amount (shown in the Payment section) are calculated from the plan and cannot be typed. Take a first payment below, or leave it blank and the
              membership starts unpaid.
            </Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <Controller
                control={control}
                name="planId"
                render={({ field: f }) => (
                  <TextField select label="Plan" {...f} disabled={isSubmitting} helperText="Only active plans can be chosen">
                    <MenuItem value="">No plan yet</MenuItem>
                    {plans.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name} · {formatPlanDuration(p.durationValue, p.durationUnit)} · {formatInr(p.pricePaise)}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              {chosenPlan && (
                <>
                  {field('membershipStart', 'Membership start date *', dateProps)}
                  <TextField label="End date" value={endPreview ? formatIstDate(endPreview) : ''} disabled slotProps={{ input: { readOnly: true } }} helperText="Calculated, inclusive" />
                </>
              )}
            </Box>
          </Paper>
        )}

        {mode === 'create' && plans && chosenPlan && (
          <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label="Payment">
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              Payment (optional)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Amount Paid 0 or blank records no payment and the membership starts unpaid. The mode is required when an amount is
              entered. Later payments are recorded from the member&apos;s profile or the Payments pages.
            </Typography>
            <PaymentFields
              values={payment}
              errors={paymentErrors}
              onChange={changePayment}
              disabled={isSubmitting}
              totalPaise={chosenPlan.pricePaise}
              onBlurAmount={() => void trigger(['paymentAmount'])}
            />
          </Paper>
        )}

        {mode === 'create' && (
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Consent
            </Typography>
            <Controller
              control={control}
              name="consent"
              render={({ field: f }) => (
                <FormControlLabel
                  control={<Checkbox checked={f.value} onChange={(e) => f.onChange(e.target.checked)} onBlur={f.onBlur} disabled={isSubmitting} />}
                  label={under18 ? CONSENT_TEXT_GUARDIAN : CONSENT_TEXT_ADULT}
                />
              )}
            />
            {errors.consent && <FormHelperText error>{errors.consent.message}</FormHelperText>}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {plans
                ? 'Without a plan the member starts with no membership; an Admin can assign one later.'
                : 'Only an Admin can assign a plan or take a payment; a new member registered here starts with no membership.'}
            </Typography>
          </Paper>
        )}

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting || (gatesSubmit && !duplicateConfirmed)}>
            {isSubmitting ? 'Saving…' : submitLabel}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
