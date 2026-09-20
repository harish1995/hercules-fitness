import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberForm } from '../../components/members/MemberForm';
import { memberProfilePath } from '../../constants/routes';
import { toDayInputValue } from '../../domain/dates';
import { toMemberProfileInput, type MemberFormValues } from '../../domain/validation/member';
import { useActor } from '../../hooks/useActor';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../hooks/useToast';
import { useTrainers } from '../../hooks/useTrainers';
import { toUserMessage } from '../../services/errors';
import { getMemberMedical } from '../../services/memberMedicalService';
import { findMemberByMobile, getMember, updateMember } from '../../services/memberService';
import { type Member, type Trainer } from '../../types/member';

function toFormValues(member: Member, medicalNotes: string): MemberFormValues {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    gender: member.gender,
    dateOfBirth: toDayInputValue(member.dateOfBirth),
    mobile: member.mobile,
    email: member.email ?? '',
    address: member.address ?? '',
    emergencyName: member.emergencyContact?.name ?? '',
    emergencyMobile: member.emergencyContact?.mobile ?? '',
    trainerId: member.trainerId ?? '',
    joiningDate: toDayInputValue(member.joiningDate),
    generalNotes: member.generalNotes ?? '',
    medicalNotes,
    consent: true, // recorded at registration; never re-asked on edit
    planId: '', // memberships are changed only through assign / renew, never on this form
    membershipStart: '',
    // payments are recorded only through the payment dialog / first payment at registration, never on this form
    paymentAmount: '',
    paymentDate: '',
    paymentMethod: '',
    paymentReference: '',
    paymentNotes: '',
  };
}

/** Edit a member (Admin). Saves with an optimistic-concurrency guard (US-2.10d): a stale form gets a CONFLICT. */
export function MemberEditPage() {
  const { memberDocId = '' } = useParams();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const trainers = useTrainers();
  const isAdmin = actor?.role === 'ADMIN';

  const loaded = useAsyncData(async () => {
    const member = await getMember(memberDocId);
    if (!member) return null;
    const medical = isAdmin ? await getMemberMedical(memberDocId) : null;
    return { member, medicalNotes: medical?.notes ?? '' };
  }, `edit:${memberDocId}:${isAdmin ? 'a' : 's'}`);

  if (!actor || !isAdmin) return <ErrorState title="Not available" message="Only an Admin can edit members." />;
  if ((loaded.status === 'loading' && !loaded.data && loaded.data !== null) || (trainers.status === 'loading' && !trainers.data)) {
    return <LoadingState label="Loading member…" />;
  }
  if (loaded.status === 'error') return <ErrorState message={toUserMessage(loaded.error)} onRetry={loaded.reload} />;
  if (trainers.status === 'error') return <ErrorState message={toUserMessage(trainers.error)} onRetry={trainers.reload} />;
  if (!loaded.data) {
    return (
      <EmptyState
        title="Member not found"
        description="This member does not exist or has been deleted."
      />
    );
  }

  const { member, medicalNotes } = loaded.data;
  // the member's current trainer stays selectable even if since deactivated
  const trainerOptions: Trainer[] = (trainers.data ?? []).filter((t) => t.active || t.id === member.trainerId);

  async function submit(values: MemberFormValues, options: { duplicateMobileConfirmed: boolean }) {
    if (!actor) return;
    const result = await updateMember({
      memberDocId,
      expectedVersion: member.version,
      currentMobile: member.mobile,
      duplicateMobileConfirmed: options.duplicateMobileConfirmed,
      actor,
      input: { profile: toMemberProfileInput(values), medicalNotes: values.medicalNotes.trim() },
    });
    toast[result.changed ? 'success' : 'info'](result.changed ? 'Member updated.' : 'No changes to save.');
    void navigate(memberProfilePath(memberDocId));
  }

  return (
    <>
      <PageHeader title={`Edit ${member.displayName}`} subtitle={`${member.memberId} (the Member ID cannot be changed)`} />
      <MemberForm
        key={member.version}
        mode="edit"
        defaultValues={toFormValues(member, medicalNotes)}
        trainers={trainerOptions}
        canEditMedical
        ownMemberDocId={member.id}
        onSubmit={submit}
        onCancel={() => void navigate(memberProfilePath(memberDocId))}
        checkMobile={(mobile) => findMemberByMobile(mobile, actor.role, member.id)}
        onReload={loaded.reload}
        submitLabel="Save changes"
      />
    </>
  );
}
