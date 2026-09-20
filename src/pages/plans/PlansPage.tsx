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
  MenuItem,
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
import { DURATION_UNIT_LABELS, DURATION_UNITS } from '../../constants/enums';
import { formatInr, fromPaise } from '../../domain/money';
import { formatPlanDuration } from '../../domain/renewal';
import { EMPTY_PLAN_FORM, planFormSchema, toPlanInput, type PlanFormValues } from '../../domain/validation/plan';
import { useActor } from '../../hooks/useActor';
import { usePlans } from '../../hooks/usePlans';
import { useToast } from '../../hooks/useToast';
import { toUserMessage } from '../../services/errors';
import { createPlan, deletePlan, generatePlanDocId, updatePlan } from '../../services/planService';
import { type Plan } from '../../types/membership';

function toFormValues(plan: Plan | null): PlanFormValues {
  if (!plan) return EMPTY_PLAN_FORM;
  return {
    name: plan.name,
    durationValue: String(plan.durationValue),
    durationUnit: plan.durationUnit,
    // rupees for the form only (display maths); the stored value stays integer paise
    price: String(fromPaise(plan.pricePaise)),
    description: plan.description ?? '',
    active: plan.active,
  };
}

interface PlanDialogProps {
  plan: Plan | null;
  onClose: () => void;
  onSave: (values: PlanFormValues) => Promise<void>;
}

function PlanDialog({ plan, onClose, onSave }: PlanDialogProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({ resolver: zodResolver(planFormSchema), defaultValues: toFormValues(plan) });
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
    <Dialog open onClose={isSubmitting ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="plan-dialog-title">
      <form noValidate onSubmit={(e) => void submit(e)}>
        <DialogTitle id="plan-dialog-title">{plan ? 'Edit plan' : 'Add plan'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {plan && (
              <Alert severity="info">Changing the price or duration affects new memberships only. Existing memberships keep their own amount and dates.</Alert>
            )}
            <TextField label="Name *" {...register('name')} error={Boolean(errors.name)} helperText={errors.name?.message} disabled={isSubmitting} autoFocus />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Duration *"
                {...register('durationValue')}
                error={Boolean(errors.durationValue)}
                helperText={errors.durationValue?.message}
                disabled={isSubmitting}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ flex: 1 }}
              />
              <Controller
                control={control}
                name="durationUnit"
                render={({ field }) => (
                  <TextField select label="Unit *" {...field} disabled={isSubmitting} sx={{ flex: 1 }}>
                    {DURATION_UNITS.map((u) => (
                      <MenuItem key={u} value={u}>
                        {DURATION_UNIT_LABELS[u]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>
            <TextField
              label="Price (₹) *"
              {...register('price')}
              error={Boolean(errors.price)}
              helperText={errors.price?.message ?? 'Must be greater than 0'}
              disabled={isSubmitting}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField label="Description" {...register('description')} error={Boolean(errors.description)} helperText={errors.description?.message ?? 'Optional'} disabled={isSubmitting} multiline minRows={2} />
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={isSubmitting} />}
                  label="Active (can be sold)"
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

/**
 * Membership plans (US-3.1 to US-3.3). Admin creates, edits, activates / deactivates and deletes (only when no membership
 * references the plan); Staff can view. A deactivated plan cannot be sold but stays on existing memberships.
 */
export function PlansPage() {
  const actor = useActor();
  const toast = useToast();
  const plans = usePlans();
  const canManage = actor?.role === 'ADMIN';
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  // one document id per "Add plan" dialog so a retried submit targets the same document
  const [newPlanId, setNewPlanId] = useState(() => generatePlanDocId());
  const [toDelete, setToDelete] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function save(values: PlanFormValues) {
    if (!actor) return;
    const input = toPlanInput(values);
    if (editing === 'new') {
      await createPlan({ planDocId: newPlanId, input, actor });
      setNewPlanId(generatePlanDocId());
      toast.success('Plan added.');
    } else if (editing) {
      const changed = await updatePlan({ planId: editing.id, input, actor });
      toast[changed.length > 0 ? 'success' : 'info'](changed.length > 0 ? 'Plan updated.' : 'No changes to save.');
    }
    setEditing(null);
    plans.reload();
  }

  async function toggleActive(plan: Plan) {
    if (!actor) return;
    setToggling(plan.id);
    try {
      await updatePlan({
        planId: plan.id,
        actor,
        input: {
          name: plan.name, durationValue: plan.durationValue, durationUnit: plan.durationUnit,
          pricePaise: plan.pricePaise, description: plan.description, active: !plan.active,
        },
      });
      toast.success(plan.active ? `${plan.name} was deactivated.` : `${plan.name} was activated.`);
      plans.reload();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setToggling(null);
    }
  }

  async function doDelete() {
    if (!toDelete || !actor) return;
    setDeleting(true);
    try {
      await deletePlan({ planId: toDelete.id, actor });
      toast.success('Plan deleted.');
      plans.reload();
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
        title="Membership Plans"
        subtitle={canManage ? undefined : 'Read only'}
        actions={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              Add plan
            </Button>
          ) : undefined
        }
      />
      {plans.status === 'loading' && !plans.data ? (
        <LoadingState label="Loading plans…" />
      ) : plans.status === 'error' ? (
        <ErrorState title="Could not load plans" message={toUserMessage(plans.error)} onRetry={plans.reload} />
      ) : (plans.data ?? []).length === 0 ? (
        <EmptyState title="No plans yet" description={canManage ? 'Add a plan (for example Monthly, 1 month) to start selling memberships.' : undefined} />
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table aria-label="Membership plans">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell>Status</TableCell>
                  {canManage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {(plans.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.name}
                      {p.description && (
                        <>
                          <br />
                          <span style={{ fontSize: 12, opacity: 0.7 }}>{p.description}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell>{formatPlanDuration(p.durationValue, p.durationUnit)}</TableCell>
                    <TableCell align="right">{formatInr(p.pricePaise)}</TableCell>
                    <TableCell>
                      <Chip size="small" color={p.active ? 'success' : 'default'} variant="outlined" label={p.active ? 'Active' : 'Inactive'} />
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <Button size="small" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                        <Button size="small" onClick={() => void toggleActive(p)} disabled={toggling === p.id}>
                          {p.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="small" color="error" onClick={() => setToDelete(p)}>
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

      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.name ?? 'plan'}?`}
        message="A plan that any membership uses (including memberships of deleted members) cannot be deleted: deactivate it instead. Deactivated plans stay visible on existing memberships."
        confirmLabel="Delete plan"
        destructive
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
