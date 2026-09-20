import { Chip, Stack } from '@mui/material';
import { formatIstDate, isUnder18, type Clock } from '../../domain/dates';
import { calculateMembershipStatus, STATUS_LABELS, type MembershipStatus } from '../../domain/status';
import { type Member } from '../../types/member';

const COLORS: Record<MembershipStatus, 'success' | 'warning' | 'error' | 'default'> = {
  ACTIVE: 'success',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'error',
  SUSPENDED: 'default',
  NO_MEMBERSHIP: 'default',
};

type BadgeMember = Pick<Member, 'suspended' | 'dateOfBirth' | 'membership'>;

/**
 * The status chip, derived on every render from the member's LATEST end date and the stored suspended flag (D-4, D-5):
 * never stored (FR-4). "Under 18" is computed from the DOB on the IST date, never stored (US-2.7c). A membership that
 * has not started yet also shows "Starts DD/MM/YYYY" (NEW-5); the status itself still comes from the end date only.
 */
export function MemberStatusBadge({ member, clock }: { member: BadgeMember; clock?: Clock }) {
  let status: MembershipStatus = 'NO_MEMBERSHIP';
  let startsInFuture = false;
  let invalid = false;
  try {
    ({ status, startsInFuture } = calculateMembershipStatus(member.membership.startDate, member.membership.endDate, {
      suspended: member.suspended,
      clock,
    }));
  } catch {
    invalid = true; // end before start: corrupt data is flagged, never silently computed (US-3.4e)
  }
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {invalid ? (
        <Chip size="small" color="error" variant="outlined" label="Check dates" />
      ) : status === 'SUSPENDED' ? (
        <Chip size="small" color="warning" label={STATUS_LABELS.SUSPENDED} />
      ) : (
        <Chip size="small" color={COLORS[status]} variant={status === 'NO_MEMBERSHIP' ? 'outlined' : 'filled'} label={STATUS_LABELS[status]} />
      )}
      {startsInFuture && member.membership.startDate && (
        <Chip size="small" variant="outlined" label={`Starts ${formatIstDate(member.membership.startDate)}`} />
      )}
      {isUnder18(member.dateOfBirth) && <Chip size="small" color="info" label="Under 18" />}
    </Stack>
  );
}
