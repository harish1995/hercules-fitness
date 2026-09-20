import { Paper } from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberForm } from '../../components/members/MemberForm';
import { PhotoPicker } from '../../components/members/PhotoPicker';
import { memberProfilePath, ROUTES } from '../../constants/routes';
import { formatIstDate, isUnder18, parseDayInput, toDayInputValue, todayIstStart } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { EMPTY_MEMBER_FORM, toMemberProfileInput, type MemberFormValues } from '../../domain/validation/member';
import { validatePaymentForm } from '../../domain/validation/payment';
import { useActor } from '../../hooks/useActor';
import { usePlans } from '../../hooks/usePlans';
import { useToast } from '../../hooks/useToast';
import { useTrainers } from '../../hooks/useTrainers';
import { toUserMessage } from '../../services/errors';
import { findMemberByMobile, generateMemberDocId, registerMember } from '../../services/memberService';
import { saveMemberPhoto } from '../../services/memberPhotoService';
import { type MemberPhoto } from '../../types/member';

/**
 * Register a member (US-2.1). An Admin can also pick a plan and start date, which creates the first membership in the same
 * transaction (US-3.5b), optionally with the first payment (US-4.2). Staff register without a plan or a payment (permission
 * matrix: assign plan and record payment = Admin).
 */
export function MemberRegisterPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const trainers = useTrainers();
  const isAdmin = actor?.role === 'ADMIN';
  const plans = usePlans();
  // ONE document id per form visit: a retried or double-clicked submit targets the same document (idempotent).
  const [memberDocId] = useState(() => generateMemberDocId());
  const [photo, setPhoto] = useState<MemberPhoto | null>(null);

  const defaultValues = useMemo<MemberFormValues>(
    () => ({ ...EMPTY_MEMBER_FORM, joiningDate: toDayInputValue(todayIstStart()), paymentDate: toDayInputValue(todayIstStart()) }),
    [],
  );

  if (!actor) return <ErrorState title="Not available" message="Your role cannot register members." />;
  if (trainers.status === 'loading' && !trainers.data) return <LoadingState label="Loading…" />;
  if (trainers.status === 'error') {
    return <ErrorState message={toUserMessage(trainers.error)} onRetry={trainers.reload} />;
  }
  if (isAdmin && plans.status === 'loading' && !plans.data) return <LoadingState label="Loading…" />;
  if (isAdmin && plans.status === 'error') return <ErrorState message={toUserMessage(plans.error)} onRetry={plans.reload} />;

  async function submit(values: MemberFormValues, options: { duplicateMobileConfirmed: boolean }) {
    if (!actor) return;
    const profile = toMemberProfileInput(values);
    const startDate = values.planId ? parseDayInput(values.membershipStart) : null;
    // The form schema already validated the payment against the plan price; this only converts it (blank / 0 = no payment).
    const planPrice = (plans.data ?? []).find((p) => p.id === values.planId)?.pricePaise;
    const firstPayment =
      isAdmin && startDate && planPrice !== undefined
        ? (validatePaymentForm(values, { capPaise: planPrice, required: false }).details ?? undefined)
        : undefined;
    const result = await registerMember({
      memberDocId,
      actor,
      hasPhoto: photo !== null,
      duplicateMobileConfirmed: options.duplicateMobileConfirmed,
      input: {
        profile,
        medicalNotes: actor.role === 'ADMIN' ? values.medicalNotes.trim() || null : null,
        consentGiven: values.consent,
        guardianConsent: isUnder18(profile.dateOfBirth),
        ...(isAdmin && values.planId && startDate ? { membership: { planId: values.planId, startDate, ...(firstPayment ? { firstPayment } : {}) } } : {}),
      },
    });
    if (photo) {
      try {
        await saveMemberPhoto({
          member: { id: memberDocId, memberId: result.memberId, displayName: `${profile.firstName} ${profile.lastName}`, hasPhoto: true },
          photo,
          actor,
        });
      } catch {
        // US-2.5d: the member exists; the profile offers a retry for the photo.
        toast.warning(`Member ${result.memberId} was registered, but the photo could not be saved. Add it again from the profile.`);
        void navigate(memberProfilePath(memberDocId));
        return;
      }
    }
    toast.success(
      result.alreadyExisted
        ? `Member ${result.memberId} was already registered.`
        : `Member registered with ID ${result.memberId}.${
            result.membership
              ? ` Membership: ${formatIstDate(result.membership.startDate)} to ${formatIstDate(result.membership.endDate)}.${
                  result.membership.paidPaise > 0
                    ? ` Paid ${formatInr(result.membership.paidPaise)}, pending ${formatInr(result.membership.amountPaise - result.membership.paidPaise)}.`
                    : ''
                }`
              : ''
          }`,
    );
    void navigate(memberProfilePath(memberDocId));
  }

  return (
    <>
      <PageHeader title="Register member" subtitle="A Member ID (GYM-YYYY-NNNN) is assigned when you save." />
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, bgcolor: 'transparent', border: 'none' }}>
        <MemberForm
          mode="create"
          defaultValues={defaultValues}
          trainers={(trainers.data ?? []).filter((t) => t.active)}
          canEditMedical={actor.role === 'ADMIN'}
          onSubmit={submit}
          onCancel={() => void navigate(ROUTES.members)}
          checkMobile={(mobile) => findMemberByMobile(mobile, actor.role)}
          plans={isAdmin ? (plans.data ?? []).filter((p) => p.active) : undefined}
          photoSlot={<PhotoPicker value={photo} onChange={setPhoto} />}
          submitLabel="Register member"
        />
      </Paper>
    </>
  );
}
