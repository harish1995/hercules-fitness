import AddIcon from '@mui/icons-material/Add';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { PageHeader } from '../../components/common/PageHeader';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { toTrainerInput, trainerFormSchema, type TrainerFormValues } from '../../domain/validation/trainer';
import { useActor } from '../../hooks/useActor';
import { useToast } from '../../hooks/useToast';
import { useTrainers } from '../../hooks/useTrainers';
import { toUserMessage } from '../../services/errors';
import { createTrainer, deleteTrainer, updateTrainer } from '../../services/trainerService';
import { type Trainer } from '../../types/member';

interface TrainerDialogProps {
  trainer: Trainer | null;
  onClose: () => void;
  onSave: (values: TrainerFormValues) => Promise<void>;
}

function TrainerDialog({ trainer, onClose, onSave }: TrainerDialogProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TrainerFormValues>({
    resolver: zodResolver(trainerFormSchema),
    defaultValues: { name: trainer?.name ?? '', mobile: trainer?.mobile ?? '', active: trainer?.active ?? true },
  });
  const [error, setError] = useState<string | null>(null);

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(values);
    } catch (e) {
      setError(toUserMessage(e));
    }
  });

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="trainer-dialog-title">
      <form noValidate onSubmit={(e) => void submit(e)}>
        <DialogTitle id="trainer-dialog-title">{trainer ? 'Edit trainer' : 'Add trainer'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name *" {...register('name')} error={Boolean(errors.name)} helperText={errors.name?.message} disabled={isSubmitting} autoFocus />
            <TextField label="Mobile" {...register('mobile')} error={Boolean(errors.mobile)} helperText={errors.mobile?.message ?? 'Optional'} disabled={isSubmitting} />
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={isSubmitting} />}
                  label="Active (can be assigned to members)"
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Trainers: simple CRUD (NEW-2). Admin manages; Staff can read (US-2.13c). Delete is refused while members are assigned. */
export function TrainersPage() {
  const actor = useActor();
  const toast = useToast();
  const trainers = useTrainers();
  const canManage = actor?.role === 'ADMIN';
  const [editing, setEditing] = useState<Trainer | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Trainer | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function save(values: TrainerFormValues) {
    if (!actor) return;
    const input = toTrainerInput(values);
    if (editing === 'new') await createTrainer(input, actor.uid);
    else if (editing) await updateTrainer(editing.id, input, actor.uid);
    toast.success(editing === 'new' ? 'Trainer added.' : 'Trainer updated.');
    setEditing(null);
    trainers.reload();
  }

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteTrainer(toDelete.id);
      toast.success('Trainer deleted.');
      trainers.reload();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Trainers"
        subtitle={canManage ? undefined : 'Read only'}
        actions={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              Add trainer
            </Button>
          ) : undefined
        }
      />
      {trainers.status === 'loading' && !trainers.data ? (
        <LoadingState label="Loading trainers…" />
      ) : trainers.status === 'error' ? (
        <ErrorState title="Could not load trainers" message={toUserMessage(trainers.error)} onRetry={trainers.reload} />
      ) : (trainers.data ?? []).length === 0 ? (
        <EmptyState title="No trainers yet" description={canManage ? 'Add a trainer to assign them to members.' : undefined} />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Trainers">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell>Status</TableCell>
                  {canManage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {(trainers.data ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.mobile ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" color={t.active ? 'success' : 'default'} variant="outlined" label={t.active ? 'Active' : 'Inactive'} />
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <Button size="small" onClick={() => setEditing(t)}>
                          Edit
                        </Button>
                        <Button size="small" color="error" onClick={() => setToDelete(t)}>
                          Delete
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {editing && <TrainerDialog trainer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.name ?? 'trainer'}?`}
        message="A trainer who is assigned to members cannot be deleted; deactivate them instead."
        confirmLabel="Delete trainer"
        destructive
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
