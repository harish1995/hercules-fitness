import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { useActor } from '../../hooks/useActor';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { setSuspended } from '../../services/membershipService';
import { type Member } from '../../types/member';

const REASON_MAX = 200;

interface SuspendDialogProps {
  member: Member;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Suspend (with an optional reason) or reactivate, depending on the member's current flag (US-3.11). Suspending only sets
 * the flag: the membership dates are not changed (no expiry extension). The reason is visible to Staff and is never copied
 * to the audit log, so the field warns against health details.
 */
export function SuspendDialog({ member, onClose, onDone }: SuspendDialogProps) {
  const actor = useActor();
  const toast = useToast();
  const suspending = !member.suspended;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      const { changed } = await setSuspended({ memberDocId: member.id, suspend: suspending, reason, actor });
      toast[changed ? 'success' : 'info'](
        changed
          ? suspending
            ? `${member.displayName} was suspended.`
            : `${member.displayName} was reactivated.`
          : `${member.displayName} was already ${suspending ? 'suspended' : 'active'}.`,
      );
      onDone();
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="suspend-dialog-title">
      <DialogTitle id="suspend-dialog-title">
        {suspending ? 'Suspend' : 'Reactivate'} {member.displayName}?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {suspending
              ? 'The member shows as Suspended regardless of the dates and cannot be renewed until reactivated. Their membership dates are not changed.'
              : 'The status is calculated from the membership dates again (it may be Expired straight away).'}
          </DialogContentText>
          {error && <Alert severity="error">{error}</Alert>}
          {suspending && (
            <TextField
              label="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
              helperText={`Up to ${REASON_MAX} characters. Staff can see this: do not enter medical or health details.`}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={suspending ? 'warning' : 'primary'}
          onClick={() => void confirm()}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {suspending ? 'Suspend' : 'Reactivate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
