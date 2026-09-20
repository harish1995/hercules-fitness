import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../hooks/useAuth';
import { AppError } from '../services/errors';
import { type AppUser, type UserDoc } from '../types';
import { AuthProvider } from './AuthContext';

const mocks = vi.hoisted(() => ({
  emit: null as null | ((user: AppUser | null) => void),
  signOutUser: vi.fn(),
  getUserDoc: vi.fn(),
}));

vi.mock('../services/authService', () => ({
  observeAuth: (cb: (user: AppUser | null) => void) => {
    mocks.emit = cb;
    return () => undefined;
  },
  signOutUser: mocks.signOutUser,
  signIn: vi.fn(),
  sendReset: vi.fn(),
}));
vi.mock('../services/userService', () => ({ getUserDoc: mocks.getUserDoc }));

function Probe() {
  const { state, retryRole, acknowledgeNoAccess } = useAuth();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <button onClick={retryRole}>retry</button>
      <button onClick={acknowledgeNoAccess}>ack</button>
    </div>
  );
}

const user: AppUser = { uid: 'u1', email: 'u1@example.com', displayName: null };

beforeEach(() => {
  mocks.signOutUser.mockReset();
  mocks.getUserDoc.mockReset();
  mocks.signOutUser.mockImplementation(async () => {
    mocks.emit?.(null);
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
});

describe('AuthProvider retry and acknowledge', () => {
  it('retryRole recovers from a network error', async () => {
    mocks.getUserDoc
      .mockRejectedValueOnce(new AppError('NETWORK'))
      .mockResolvedValueOnce({ role: 'ADMIN', active: true } as UserDoc);
    await act(async () => mocks.emit?.(user));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('roleError'));
    await userEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
  });

  it('acknowledgeNoAccess returns to signedOut', async () => {
    mocks.getUserDoc.mockResolvedValue(null);
    await act(async () => mocks.emit?.(user));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('noAccess'));
    await userEvent.click(screen.getByText('ack'));
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
  });
});
