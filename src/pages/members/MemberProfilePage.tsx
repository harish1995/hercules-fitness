import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { MemberStatusBadge } from '../../components/members/MemberStatusBadge';
import { PhotoPicker } from '../../components/members/PhotoPicker';
import { MembershipDialog } from '../../components/memberships/MembershipDialog';
import { PagerBar } from '../../components/common/PagerBar';
import { AttendanceTable } from '../../components/attendance/AttendanceTable';
import { MemberAttendanceDialog } from '../../components/attendance/MemberAttendanceDialog';
import { PaymentsTable } from '../../components/payments/PaymentsTable';
import { RecordPaymentDialog } from '../../components/payments/RecordPaymentDialog';
import { VoidPaymentDialog } from '../../components/payments/VoidPaymentDialog';
import { SuspendDialog } from '../../components/memberships/SuspendDialog';
import { GENDER_LABELS } from '../../constants/enums';
import { memberEditPath, ROUTES } from '../../constants/routes';
import { ATTENDANCE_PAGE_SIZE } from '../../domain/attendanceQueryPlans';
import { formatIstDate, formatIstDateTime } from '../../domain/dates';
import { formatInr } from '../../domain/money';
import { PAYMENT_STATE_LABELS, paymentState } from '../../domain/payment';
import { PAYMENT_PAGE_SIZE } from '../../domain/paymentQueryPlans';
import { formatPlanDuration } from '../../domain/renewal';
import { calculateMembershipStatus, describeDaysRemaining, type StatusResult } from '../../domain/status';
import { useActor } from '../../hooks/useActor';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useMembershipHistory, type MembershipHistoryState } from '../../hooks/useMembershipHistory';
import { usePagedList } from '../../hooks/usePagedList';
import { useToast } from '../../hooks/useToast';
import { listMemberAttendance } from '../../services/attendanceService';
import { toUserMessage } from '../../services/errors';
import { getMemberMedical } from '../../services/memberMedicalService';
import { getMemberPhoto, removeMemberPhoto, saveMemberPhoto } from '../../services/memberPhotoService';
import { getMember, softDeleteMember } from '../../services/memberService';
import { listMemberPayments } from '../../services/paymentService';
import { type AttendanceRecord } from '../../types/attendance';
import { type Member, type MemberPhoto } from '../../types/member';
import { type Payment } from '../../types/payment';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>
        {children || '—'}
      </Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} component="section" aria-label={title}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function PhotoBlock({
  member,
  photo,
  photoError,
  onRetry,
  onSaved,
}: {
  member: Member;
  photo: MemberPhoto | null;
  /** the photo document could not be fetched (network / rules): the profile still works, with a retry */
  photoError: unknown;
  onRetry: () => void;
  onSaved: () => void;
}) {
  const actor = useActor();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Staff may add a first photo (e.g. a retry after a failed registration upload) but not replace one; Admin may do both.
  const canChange = actor !== null && (actor.role === 'ADMIN' || photo === null);
  const isAdmin = actor?.role === 'ADMIN';

  async function save(next: MemberPhoto | null) {
    if (!actor) return;
    if (next === null) {
      // the picker's "Remove": Admin deletes the stored photo (after confirmation); anyone else just cannot
      if (isAdmin && photo !== null) setConfirmRemove(true);
      return;
    }
    setSaving(true);
    try {
      await saveMemberPhoto({ member, photo: next, actor });
      toast.success('Photo saved.');
      onSaved();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!actor) return;
    setSaving(true);
    try {
      await removeMemberPhoto({ memberDocId: member.id, actor });
      toast.success('Photo removed.');
      onSaved();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setSaving(false);
      setConfirmRemove(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      {photoError !== undefined && photoError !== null && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          The photo could not be loaded. {toUserMessage(photoError)}
        </Alert>
      )}
      {photoError == null && member.hasPhoto && photo === null && (
        <Alert severity="warning">The photo could not be saved when this member was registered. Add it again below.</Alert>
      )}
      {canChange ? (
        <PhotoPicker
          value={photo}
          onChange={(p) => void save(p)}
          // Remove only makes sense for a stored photo, and only an Admin may delete it
          disabled={saving}
          allowRemove={isAdmin && photo !== null}
          label={photo ? 'Replace photo' : 'Add photo'}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Only an Admin can replace an existing photo.
        </Typography>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this photo?"
        message="The stored photo is deleted. You can add a new one afterwards."
        confirmLabel="Remove photo"
        destructive
        loading={saving}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </Stack>
  );
}

/** The membership summary + history for the profile (US-3.13). Everything is derived from stored dates; nothing is stored as status. */
function MembershipSummaryBlock({ member, status }: { member: Member; status: StatusResult | null }) {
  const ms = member.membership;
  if (!member.hasMembership || ms.endDate === null) {
    return <EmptyState title="No membership yet" description="Assign a plan to give this member a membership period." />;
  }
  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
        <Detail label="Plan">{ms.planName}</Detail>
        <Detail label="Start date">{ms.startDate ? formatIstDate(ms.startDate) : null}</Detail>
        <Detail label="Expiry date">{formatIstDate(ms.endDate)}</Detail>
        <Detail label="Days remaining">{describeDaysRemaining(status?.daysRemaining ?? null)}</Detail>
        <Detail label="Latest membership amount">{ms.amountPaise !== null ? formatInr(ms.amountPaise) : null}</Detail>
        <Detail label="Amount pending (all memberships)">{formatInr(member.pendingPaise)}</Detail>
      </Box>
      {status?.startsInFuture && ms.startDate && <Alert severity="info">Starts on {formatIstDate(ms.startDate)}.</Alert>}
      {member.suspended && (
        <Alert severity="warning">
          Suspended{member.suspendedAt ? ` on ${formatIstDate(member.suspendedAt)}` : ''}
          {member.suspendedReason ? `: ${member.suspendedReason}` : ''}. The dates above are unchanged; the status is Suspended until
          the member is reactivated.
        </Alert>
      )}
    </Stack>
  );
}

function MembershipHistoryBlock({ history }: { history: MembershipHistoryState }) {
  if (history.status === 'loading' && history.items.length === 0) return <LoadingState label="Loading history…" />;
  if (history.status === 'error') {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={history.reload}>Retry</Button>}>
        {toUserMessage(history.error)}
      </Alert>
    );
  }
  if (history.items.length === 0) return <EmptyState title="No memberships yet" description="Past memberships and renewals will be listed here." />;
  const today = new Date();
  return (
    <Stack spacing={1}>
      <TableContainer>
        <Table size="small" aria-label="Membership history">
          <TableHead>
            <TableRow>
              <TableCell>Plan</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Paid</TableCell>
              <TableCell align="right">Outstanding</TableCell>
              <TableCell>Payment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.items.map((h) => {
              // "Starts on" is derived from the dates, never stored (US-3.13c)
              const future = h.startDate.getTime() > today.getTime();
              return (
                <TableRow key={h.id}>
                  <TableCell>
                    {h.planName}
                    <br />
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{formatPlanDuration(h.planDurationValue, h.planDurationUnit)}</span>
                  </TableCell>
                  <TableCell>
                    {formatIstDate(h.startDate)} to {formatIstDate(h.endDate)}
                    {future && <Chip size="small" variant="outlined" sx={{ ml: 1 }} label={`Starts on ${formatIstDate(h.startDate)}`} />}
                  </TableCell>
                  <TableCell align="right">{formatInr(h.amountPaise)}</TableCell>
                  <TableCell align="right">{formatInr(h.paidPaise)}</TableCell>
                  <TableCell align="right">{formatInr(h.outstandingPaise)}</TableCell>
                  <TableCell>
                    {/* derived from paid vs total, never stored (D-7) */}
                    <Chip
                      size="small"
                      variant="outlined"
                      color={paymentState(h.amountPaise, h.paidPaise) === 'PAID' ? 'success' : paymentState(h.amountPaise, h.paidPaise) === 'PARTIAL' ? 'warning' : 'error'}
                      label={PAYMENT_STATE_LABELS[paymentState(h.amountPaise, h.paidPaise)]}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {history.moreError !== undefined && history.moreError !== null && <Alert severity="error">{toUserMessage(history.moreError)}</Alert>}
      {history.hasMore && (
        <Box>
          <Button size="small" onClick={history.loadMore} disabled={history.loadingMore}>
            {history.loadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** Payment history (Admin only, US-4.4a): every payment newest first, paginated, voided rows kept and marked (US-4.7b). No edit or delete. */
function PaymentHistoryBlock({
  memberDocId,
  refreshKey,
  membershipLabel,
  onVoid,
}: {
  memberDocId: string;
  refreshKey: number;
  membershipLabel: (membershipId: string) => string | undefined;
  onVoid: (payment: Payment) => void;
}) {
  const list = usePagedList<Payment>((cursor) => listMemberPayments(memberDocId, cursor), `member-payments:${memberDocId}:${refreshKey}`);
  if (list.status === 'loading' && list.items.length === 0) return <LoadingState label="Loading payments…" />;
  if (list.status === 'error') {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={list.reload}>Retry</Button>}>
        {toUserMessage(list.error)}
      </Alert>
    );
  }
  if (list.items.length === 0) return <EmptyState title="No payments yet" description="Payments recorded for this member will be listed here." />;
  return (
    <Stack spacing={0.5}>
      <PaymentsTable payments={list.items} showMember={false} label="Payment history" membershipLabel={membershipLabel} onVoid={onVoid} dim={list.status === 'loading'} />
      <PagerBar list={list} pageSize={PAYMENT_PAGE_SIZE} />
    </Stack>
  );
}

/** Attendance history (US-5.5, Admin and Staff): newest first, 25 per page with a server-side cursor; a past day with no check-out reads "Not recorded". */
function AttendanceHistoryBlock({ memberDocId, refreshKey }: { memberDocId: string; refreshKey: number }) {
  const list = usePagedList<AttendanceRecord>((cursor) => listMemberAttendance(memberDocId, cursor), `member-attendance:${memberDocId}:${refreshKey}`);
  if (list.status === 'loading' && list.items.length === 0) return <LoadingState label="Loading attendance…" />;
  if (list.status === 'error') {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={list.reload}>Retry</Button>}>
        {toUserMessage(list.error)}
      </Alert>
    );
  }
  if (list.items.length === 0) return <EmptyState title="No attendance yet" description="Check-ins and absences recorded for this member will be listed here." />;
  return (
    <Stack spacing={0.5}>
      <AttendanceTable records={list.items} label="Attendance history" showMember={false} now={new Date()} dim={list.status === 'loading'} />
      <PagerBar list={list} pageSize={ATTENDANCE_PAGE_SIZE} />
    </Stack>
  );
}

export function MemberProfilePage() {
  const { memberDocId = '' } = useParams();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = actor?.role === 'ADMIN';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [membershipDialog, setMembershipDialog] = useState<'assign' | 'renew' | null>(null);
  const [suspendDialog, setSuspendDialog] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [paymentsKey, setPaymentsKey] = useState(0);
  const [attendanceDialog, setAttendanceDialog] = useState(false);
  const [attendanceKey, setAttendanceKey] = useState(0);
  // shared by the Membership History table and the payment history (which labels each payment with its membership)
  const history = useMembershipHistory(memberDocId, historyKey);

  const member = useAsyncData(() => getMember(memberDocId), `member:${memberDocId}`);
  // The photo and (Admin-only) medical notes load separately and lazily; STAFF never requests the medical doc.
  const photo = useAsyncData(() => getMemberPhoto(memberDocId), `photo:${memberDocId}`);
  const medical = useAsyncData(async () => (isAdmin ? getMemberMedical(memberDocId) : null), `medical:${memberDocId}:${isAdmin ? 'a' : 's'}`);

  if (member.status === 'loading' && member.data === undefined) return <LoadingState label="Loading member…" />;
  if (member.status === 'error') return <ErrorState message={toUserMessage(member.error)} onRetry={member.reload} />;
  const m = member.data;
  if (!m) {
    return (
      <EmptyState
        title="Member not found"
        description="This member does not exist or has been deleted."
        action={
          <Button component={RouterLink} to={ROUTES.members} variant="outlined">
            Back to members
          </Button>
        }
      />
    );
  }

  // Derived on every render from the stored dates + flag (FR-4). Corrupt dates (end before start) are flagged, not computed.
  let status: StatusResult | null = null;
  try {
    status = calculateMembershipStatus(m.membership.startDate, m.membership.endDate, { suspended: m.suspended });
  } catch {
    status = null;
  }
  const membershipChanged = () => {
    setMembershipDialog(null);
    setSuspendDialog(false);
    member.reload();
    setHistoryKey((k) => k + 1);
    setPaymentsKey((k) => k + 1); // a first payment taken with an assign / renew
  };
  // a payment recorded or voided moves the member's pending total and the membership's paid / outstanding
  const paymentsChanged = () => {
    setPaymentDialog(false);
    setVoiding(null);
    member.reload();
    setHistoryKey((k) => k + 1);
    setPaymentsKey((k) => k + 1);
  };
  const membershipLabel = (id: string) => {
    const h = history.items.find((x) => x.id === id);
    return h ? `${h.planName} (${formatIstDate(h.startDate)})` : undefined;
  };
  // NEW-24: deleting is allowed, but the dialog warns about dues and a running membership
  const stillRunning = status !== null && (status.status === 'ACTIVE' || status.status === 'EXPIRING_SOON' || status.status === 'SUSPENDED');
  const deleteWarning = [
    m.pendingPaise > 0 ? `This member has ${formatInr(m.pendingPaise)} pending (their payment records are kept and still count in revenue).` : null,
    stillRunning ? 'This member has a membership that has not expired yet.' : null,
  ]
    .filter((x) => x !== null)
    .join(' ');

  async function doDelete() {
    if (!actor) return;
    setDeleting(true);
    try {
      await softDeleteMember({ memberDocId, actor });
      toast.success(`${m?.displayName ?? 'Member'} was deleted.`);
      void navigate(ROUTES.members);
    } catch (e) {
      toast.error(toUserMessage(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <PageHeader
        title={m.displayName}
        subtitle={`${m.memberId} · Joined ${formatIstDate(m.joiningDate)}`}
        actions={
          isAdmin ? (
            <Stack direction="row" spacing={1}>
              <Button component={RouterLink} to={memberEditPath(m.id)} startIcon={<EditOutlinedIcon />} variant="outlined">
                Edit
              </Button>
              <Button color="error" startIcon={<DeleteOutlineIcon />} variant="outlined" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </Stack>
          ) : undefined
        }
      />

      <Stack spacing={2.5}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: { sm: 'center' } }}>
            <Avatar src={photo.data?.dataUrl} alt={`${m.displayName} photo`} variant="rounded" sx={{ width: 96, height: 96 }} />
            <Box>
              <MemberStatusBadge member={m} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {m.hasMembership && m.membership.endDate
                  ? `${m.membership.planName ?? 'Membership'}: ${m.membership.startDate ? formatIstDate(m.membership.startDate) : '—'} to ${formatIstDate(m.membership.endDate)}${
                      status ? ` · ${describeDaysRemaining(status.daysRemaining)}` : ''
                    }`
                  : 'No membership yet.'}
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Section title="Profile">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
            <Detail label="Member ID">{m.memberId}</Detail>
            <Detail label="Gender">{GENDER_LABELS[m.gender]}</Detail>
            <Detail label="Date of birth">{formatIstDate(m.dateOfBirth)}</Detail>
            <Detail label="Mobile">{m.mobile}</Detail>
            <Detail label="Email">{m.email}</Detail>
            <Detail label="Trainer">{m.trainerName}</Detail>
            <Detail label="Joining date">{formatIstDate(m.joiningDate)}</Detail>
            <Detail label="Amount pending">{formatInr(m.pendingPaise)}</Detail>
            <Detail label="Address">{m.address}</Detail>
            <Detail label={m.consent.guardianConsent ? 'Guardian' : 'Emergency contact'}>
              {m.emergencyContact ? `${m.emergencyContact.name} · ${m.emergencyContact.mobile}` : null}
            </Detail>
          </Box>
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="caption" color="text.secondary">
              Consent
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
              <Chip size="small" color="success" variant="outlined" label={m.consent.guardianConsent ? 'Guardian consent given' : 'Consent given'} />
              <Typography variant="body2">
                Recorded {formatIstDateTime(m.consent.at)} by {m.consent.byName} ({m.consent.version})
              </Typography>
            </Stack>
          </Box>
        </Section>

        <Section title="Photo">
          <PhotoBlock
            member={m}
            photo={photo.data ?? null}
            photoError={photo.status === 'error' ? photo.error : undefined}
            onRetry={photo.reload}
            onSaved={photo.reload}
          />
        </Section>

        <Section title="Membership">
          <Stack spacing={2}>
            <MembershipSummaryBlock member={m} status={status} />
            {isAdmin && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {m.hasMembership ? (
                  <Button
                    variant="contained"
                    onClick={() => setMembershipDialog('renew')}
                    disabled={m.suspended}
                    title={m.suspended ? 'Reactivate the member before renewing' : undefined}
                  >
                    Renew
                  </Button>
                ) : (
                  <Button variant="contained" onClick={() => setMembershipDialog('assign')}>
                    Assign plan
                  </Button>
                )}
                {m.pendingPaise > 0 && (
                  <Button variant="outlined" onClick={() => setPaymentDialog(true)}>
                    Record payment
                  </Button>
                )}
                {(m.hasMembership || m.suspended) && (
                  <Button variant="outlined" color={m.suspended ? 'primary' : 'warning'} onClick={() => setSuspendDialog(true)}>
                    {m.suspended ? 'Reactivate' : 'Suspend'}
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
        </Section>
        {isAdmin && (
          <Section title="Payment history">
            <PaymentHistoryBlock memberDocId={m.id} refreshKey={paymentsKey} membershipLabel={membershipLabel} onVoid={setVoiding} />
          </Section>
        )}
        <Section title="Attendance history">
          <Stack spacing={1.5}>
            {actor && (
              <Box>
                <Button variant="outlined" size="small" onClick={() => setAttendanceDialog(true)}>
                  Check in / out
                </Button>
              </Box>
            )}
            <AttendanceHistoryBlock memberDocId={m.id} refreshKey={attendanceKey} />
          </Stack>
        </Section>
        <Section title="Membership history">
          <MembershipHistoryBlock history={history} />
        </Section>

        <Section title="Notes">
          <Stack spacing={2}>
            <Detail label="General notes">{m.generalNotes}</Detail>
            {isAdmin && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Medical notes (Admin only)
                </Typography>
                {medical.status === 'error' ? (
                  <Alert severity="error" action={<Button color="inherit" size="small" onClick={medical.reload}>Retry</Button>}>
                    {toUserMessage(medical.error)}
                  </Alert>
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {medical.status === 'loading' ? 'Loading…' : medical.data?.notes || '—'}
                  </Typography>
                )}
              </Box>
            )}
          </Stack>
        </Section>
      </Stack>

      {membershipDialog && <MembershipDialog mode={membershipDialog} member={m} onClose={() => setMembershipDialog(null)} onDone={membershipChanged} />}
      {suspendDialog && <SuspendDialog member={m} onClose={() => setSuspendDialog(false)} onDone={membershipChanged} />}
      {paymentDialog && <RecordPaymentDialog member={m} onClose={() => setPaymentDialog(false)} onDone={paymentsChanged} />}
      {voiding && <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} onDone={paymentsChanged} />}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${m.displayName}?`}
        message={`The member is hidden from all lists, counts and search. Their history (memberships, payments and the audit trail) is kept, and nothing is permanently erased. There is no undo in this version.${deleteWarning ? ` ${deleteWarning}` : ''}`}
        confirmLabel="Delete member"
        destructive
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
      {attendanceDialog && (
        <MemberAttendanceDialog memberDocId={m.id} onClose={() => setAttendanceDialog(false)} onChanged={() => setAttendanceKey((k) => k + 1)} />
      )}
    </>
  );
}
