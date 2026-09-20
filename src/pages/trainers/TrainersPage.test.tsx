import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../services/errors';
import { renderPage } from '../../test/render';
import { TrainersPage } from './TrainersPage';

const mocks = vi.hoisted(() => ({
  listTrainers: vi.fn(),
  createTrainer: vi.fn(),
  updateTrainer: vi.fn(),
  deleteTrainer: vi.fn(),
  actor: { uid: 'u1', name: 'Owner', role: 'ADMIN' },
}));
vi.mock('../../services/trainerService', () => ({
  listTrainers: mocks.listTrainers,
  createTrainer: mocks.createTrainer,
  updateTrainer: mocks.updateTrainer,
  deleteTrainer: mocks.deleteTrainer,
}));
vi.mock('../../hooks/useActor', () => ({ useActor: () => mocks.actor }));

const t1 = { id: 't1', name: 'Amit', mobile: '9876543210', active: true, createdAt: new Date(), updatedAt: new Date() };

beforeEach(() => {
  for (const k of ['listTrainers', 'createTrainer', 'updateTrainer', 'deleteTrainer'] as const) mocks[k].mockReset();
  mocks.actor = { uid: 'u1', name: 'Owner', role: 'ADMIN' };
  mocks.listTrainers.mockResolvedValue([t1]);
});

describe('TrainersPage (US-2.13, NEW-2)', () => {
  it('lists trainers with status; Admin sees the manage actions', async () => {
    renderPage(<TrainersPage />);
    expect(await screen.findByText('Amit')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add trainer' })).toBeInTheDocument();
  });

  it('Staff can read but has no add / edit / delete (US-2.13c)', async () => {
    mocks.actor = { uid: 's1', name: 'Desk', role: 'STAFF' };
    renderPage(<TrainersPage />);
    expect(await screen.findByText('Amit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add trainer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('adds a trainer: name required, valid mobile, then it is created and the list reloads (US-2.13a)', async () => {
    mocks.createTrainer.mockResolvedValue(undefined);
    renderPage(<TrainersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add trainer' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(mocks.createTrainer).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Name/), '  Priya  ');
    await userEvent.type(within(dialog).getByLabelText('Mobile'), '123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/valid 10-digit mobile/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Mobile'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createTrainer).toHaveBeenCalledWith({ name: 'Priya', mobile: null, active: true }, 'u1'));
    await waitFor(() => expect(mocks.listTrainers).toHaveBeenCalledTimes(2));
  });

  it('deactivating keeps the trainer in the list (US-2.13b)', async () => {
    mocks.updateTrainer.mockResolvedValue(undefined);
    renderPage(<TrainersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('switch'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateTrainer).toHaveBeenCalledWith('t1', { name: 'Amit', mobile: '9876543210', active: false }, 'u1'));
  });

  it('deleting asks for confirmation; a trainer assigned to members is refused with a friendly message', async () => {
    mocks.deleteTrainer.mockRejectedValue(new AppError('INVALID_DATA', { userMessage: 'This trainer is assigned to members and cannot be deleted. Deactivate the trainer instead.' }));
    renderPage(<TrainersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(mocks.deleteTrainer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete trainer' }));
    expect(await screen.findByText(/assigned to members and cannot be deleted/)).toBeInTheDocument();
  });

  it('empty and error states', async () => {
    mocks.listTrainers.mockResolvedValueOnce([]);
    const { unmount } = renderPage(<TrainersPage />);
    expect(await screen.findByText('No trainers yet')).toBeInTheDocument();
    unmount();
    mocks.listTrainers.mockRejectedValueOnce(new AppError('NETWORK'));
    renderPage(<TrainersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
  });
});
