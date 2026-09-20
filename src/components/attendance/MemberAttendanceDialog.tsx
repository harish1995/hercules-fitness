import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { MemberStatusBadge } from '../members/MemberStatusBadge';
import { describeCheckIn, evaluateCheckIn } from '../../domain/attendance';
import { formatIstDate, formatIstTime } from '../../domain/dates';
import { useActor } from '../../hooks/useActor';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../hooks/useToast';
import { checkIn, checkOut, getTodayAttendance, markAbsent } from '../../services/attendanceService';
import { AttendanceRefusalError, toUserMessage } from '../../services/errors';
import { getMember } from '../../services/memberService';
import { EmptyState } from '../feedback/EmptyState';
import { LoadingState } from '../feedback/LoadingState';

interface MemberAttendanceDialogProps {
  memberDocId: string;
  onClose: () => void;
  /** something was written: the caller reloads its list */
  onChanged: () => void;
}

/**
 * Check in / check out / mark absent for ONE member and TODAY (IST), Admin and Staff (matrix). It reads the member and today's
 * record fresh, then offers only what is legal (US-5.1 to US-5.3):
 *   no record        Check in (with the NEW-12 warning / confirmation) or Mark absent
 *   PRESENT, in      Check out
 *   PRESENT, out     nothing (already checked out)
 *   ABSENT           Check in (the same record becomes PRESENT)
 * NEW-12: SUSPENDED shows a block and no check-in button; EXPIRED and no-membership members need the box ticked; an
 * EXPIRING_SOON member shows the days remaining. The check-in transaction re-checks all of this on fresh data.
 */
export function MemberAttendanceDialog({ memberDocId, onClose, onChanged }: MemberAttendanceDialogProps) {
  const actor = useActor();
  const toast = useToast();
  const member = useAsyncData(() => getMember(memberDocId), `att-member:${memberDocId}`);
  const record = useAsyncData(() => getTodayAttendance(memberDocId), `att-record:${memberDocId}`);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = (member.status === 'loading' && member.data === undefined) || (record.status === 'loading' && record.data === undefined);
  const failed = member.status === 'error' ? member.error : record.status === 'error' ? record.error : null;
  const m = member.data;
  const today = record.data ?? null;
  const evaluation = m ? evaluateCheckIn(m) : null;

  async function run(action: 'in' | 'out' | 'absent') {
    if (!actor || !m) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'in') {
        const r = await checkIn({ memberDocId, actor, confirmed });
        const days = r.membershipStatus === 'EXPIRING_SOON' && r.daysRemaining !== null ? ` (${r.daysRemaining} day${r.daysRemaining === 1 ? '' : 's'} left)` : '';
        toast.success(`${r.memberName} checked in${days}.`);
      } else if (action === 'out') {
        const r = await checkOut({ memberDocId, actor });
        toast.success(`${r.memberName} checked out.`);
      } else {
        const r = await markAbsent({ memberDocId, actor });
        toast.success(`${r.memberName} marked absent.`);
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
      // a refusal means the screen was stale (someone else acted, or the membership changed): show the fresh state
      if (e instanceof AttendanceRefusalError) {
        member.reload();
        record.reload();
      }
    }
  }

  const canCheckIn = m !== undefined && m !== null && evaluation !== null && evaluation.action !== 'BLOCK' && (today === null || today.status === 'ABSENT');
  const checkInReady = canCheckIn && (evaluation?.action !== 'CONFIRM' || confirmed);

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="attendance-dialog-title">
      <DialogTitle id="attendance-dialog-title">{m ? m.displayName : 'Attendance'}</DialogTitle>
      <DialogContent>
        {loading ? (
          <LoadingState label="Loading…" />
        ) : failed ? (
          <Alert severity="error">{toUserMessage(failed)}</Alert>
        ) : !m ? (
          <EmptyState title="Member not found" description="This member does not exist or has been deleted." />
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {m.memberId} · {m.mobile}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <MemberStatusBadge member={m} />
              </Box>
              {m.membership.endDate && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Membership ends {formatIstDate(m.membership.endDate)}
                </Typography>
              )}
            </Box>

            {today === null ? (
              <Typography variant="body2">Not checked in today.</Typography>
            ) : today.status === 'ABSENT' ? (
              <Alert severity="info">Marked absent today. If the member has arrived, check them in.</Alert>
            ) : today.checkedOut ? (
              <Alert severity="success">
                Checked in {describeCheckIn(today)} and checked out{today.checkOutAt ? ` at ${formatIstTime(today.checkOutAt)}` : ''}.
              </Alert>
            ) : (
              <Alert severity="success">Checked in {describeCheckIn(today)}. Still in the gym.</Alert>
            )}

            {(today === null || today.status === 'ABSENT') && evaluation && evaluation.message && (
              <Alert severity={evaluation.action === 'BLOCK' ? 'error' : evaluation.action === 'CONFIRM' ? 'warning' : 'info'}>{evaluation.message}</Alert>
            )}
            {canCheckIn && evaluation?.action === 'CONFIRM' && (
              <FormControlLabel
                control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />}
                label="I confirm: check this member in anyway"
              />
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        {m && today === null && (
          <Button color="inherit" onClick={() => void run('absent')} disabled={busy}>
            Mark absent
          </Button>
        )}
        {m && today !== null && today.status === 'PRESENT' && !today.checkedOut && (
          <Button variant="contained" onClick={() => void run('out')} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            Check out
          </Button>
        )}
        {canCheckIn && (
          <Button variant="contained" onClick={() => void run('in')} disabled={busy || !checkInReady} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            Check in
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
