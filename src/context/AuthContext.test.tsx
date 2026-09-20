import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../services/errors';
import { type AppUser, type UserDoc } from '../types';
import { useAuth } from '../hooks/useAuth';
import { AuthProvider } from './AuthContext';

const mocks = vi.hoisted(() => ({
  emit: null as null | ((user: AppUser | null) => void),
  signOutUser: vi.fn(),
  getUserDoc: vi.fn(),
}));

vi.mock('../services/authService', () => ({
  observeAuth: (cb: (user: AppUser | null) => void) => {
    mocks.emit = cb;
    return () => {
      mocks.emit = null;
    };
  },
  signOutUser: mocks.signOutUser,
  signIn: vi.fn(),
  sendReset: vi.fn(),
}));
vi.mock('../services/userService', () => ({ getUserDoc: mocks.getUserDoc }));

const user: AppUser = { uid: 'u1', email: 'u1@example.com', displayName: 'U One' };

function userDoc(overrides: Partial<UserDoc> = {}): UserDoc {
  return { email: 'u1@example.com', displayName: 'U One', role: 'ADMIN', active: true, ...overrides } as UserDoc;
}

function Probe() {
  const { state, role } = useAuth();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="uid">{'user' in state ? state.user.uid : 'none'}</span>
      <span data-testid="role">{role ?? 'none'}</span>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;

async function signInAs(u: AppUser | null) {
  await act(async () => {
    mocks.emit?.(u);
  });
}

beforeEach(() => {
  // dev-only login-refusal diagnostics (utils/devDiagnostics) would otherwise print in every refusal test
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.emit = null;
  mocks.signOutUser.mockReset();
  mocks.getUserDoc.mockReset();
  // A real sign-out produces a signed-out auth event.
  mocks.signOutUser.mockImplementation(async () => {
    mocks.emit?.(null);
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
});

describe('AuthProvider state machine (architecture §4.1)', () => {
  it('starts in "initialising" (no flash of the login page) until Firebase reports', () => {
    expect(status()).toBe('initialising');
  });

  it('becomes signedOut when there is no session', async () => {
    await signInAs(null);
    expect(status()).toBe('signedOut');
  });

  it('admits an active ADMIN and exposes the role', async () => {
    mocks.getUserDoc.mockResolvedValue(userDoc());
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('ready'));
    expect(screen.getByTestId('role')).toHaveTextContent('ADMIN');
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.getUserDoc).toHaveBeenCalledWith('u1');
  });

  it('shows roleLoading (no role, no protected UI) while the lookup is in flight', async () => {
    mocks.getUserDoc.mockReturnValue(new Promise(() => undefined));
    await signInAs(user);
    expect(status()).toBe('roleLoading');
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it('refuses and signs out a user with NO users doc (US-1.6b)', async () => {
    mocks.getUserDoc.mockResolvedValue(null);
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    expect(mocks.signOutUser).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it.each([
    ['STAFF', userDoc({ role: 'STAFF' })],
    ['MEMBER', userDoc({ role: 'MEMBER' })],
    ['inactive ADMIN', userDoc({ active: false })],
    ['unknown role', userDoc({ role: 'OWNER' as unknown as UserDoc['role'] })],
  ])('refuses and signs out %s in Phase 1', async (_label, doc) => {
    mocks.getUserDoc.mockResolvedValue(doc);
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    expect(mocks.signOutUser).toHaveBeenCalledTimes(1);
  });

  it('in a dev build logs WHY a well-formed but refused doc was refused (types only, no email or name)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getUserDoc.mockResolvedValue(userDoc({ active: false }));
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    expect(warn).toHaveBeenCalledTimes(1);
    const dump = JSON.stringify(warn.mock.calls[0]);
    expect(dump).toContain('INACTIVE');
    expect(dump).not.toContain('u1@example.com');
    expect(dump).not.toContain('U One');
  });

  it('in a dev build logs a permission-denied read of the users doc', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getUserDoc.mockRejectedValue(new AppError('PERMISSION_DENIED'));
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    expect(String(warn.mock.calls[0]?.[0])).toContain('PERMISSION_DENIED');
  });

  it('keeps the noAccess message after the resulting signed-out event, until acknowledged', async () => {
    mocks.getUserDoc.mockResolvedValue(null);
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    // the mocked signOut already emitted null; the message must survive it
    expect(status()).toBe('noAccess');
  });

  it('treats a permission-denied read of the users doc as no access', async () => {
    mocks.getUserDoc.mockRejectedValue(new AppError('PERMISSION_DENIED'));
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('noAccess'));
    expect(mocks.signOutUser).toHaveBeenCalledTimes(1);
  });

  it('a network error is a retryable roleError, not a refusal, and does not sign out (US-1.6c)', async () => {
    mocks.getUserDoc.mockRejectedValueOnce(new AppError('NETWORK'));
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('roleError'));
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it('ignores a stale role lookup when the user signs out meanwhile', async () => {
    let resolveLookup: (d: UserDoc) => void = () => undefined;
    mocks.getUserDoc.mockReturnValue(new Promise<UserDoc>((r) => (resolveLookup = r)));
    await signInAs(user);
    expect(status()).toBe('roleLoading');
    await signInAs(null);
    expect(status()).toBe('signedOut');
    await act(async () => {
      resolveLookup(userDoc());
    });
    expect(status()).toBe('signedOut');
  });

  describe('user A -> user B swap while A\'s role lookup is still in flight', () => {
    const userB: AppUser = { uid: 'u2', email: 'u2@example.com', displayName: 'U Two' };
    const deferred = () => {
      let resolve: (d: UserDoc | null) => void = () => undefined;
      let reject: (e: unknown) => void = () => undefined;
      const promise = new Promise<UserDoc | null>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it('B is admitted and A\'s late "no users doc" result neither overrides B nor signs B out', async () => {
      const a = deferred();
      mocks.getUserDoc.mockImplementation((uid: string) =>
        uid === 'u1' ? a.promise : Promise.resolve(userDoc({ email: 'u2@example.com' })),
      );
      await signInAs(user);
      expect(screen.getByTestId('uid')).toHaveTextContent('u1');
      await signInAs(userB);
      await waitFor(() => expect(status()).toBe('ready'));
      expect(screen.getByTestId('uid')).toHaveTextContent('u2');

      await act(async () => {
        a.resolve(null); // A would be refused, which would sign out the current session
      });
      expect(status()).toBe('ready');
      expect(screen.getByTestId('uid')).toHaveTextContent('u2');
      expect(screen.getByTestId('role')).toHaveTextContent('ADMIN');
      expect(mocks.signOutUser).not.toHaveBeenCalled();
    });

    it('A\'s late ADMIN result does not grant A\'s access while B is refused', async () => {
      const a = deferred();
      mocks.getUserDoc.mockImplementation((uid: string) => (uid === 'u1' ? a.promise : Promise.resolve(null)));
      await signInAs(user);
      await signInAs(userB);
      await waitFor(() => expect(status()).toBe('noAccess'));
      expect(mocks.signOutUser).toHaveBeenCalledTimes(1);

      await act(async () => {
        a.resolve(userDoc());
      });
      expect(status()).not.toBe('ready');
      expect(screen.getByTestId('role')).toHaveTextContent('none');
    });

    it('A\'s late network error does not replace B\'s ready state with a retry screen', async () => {
      const a = deferred();
      mocks.getUserDoc.mockImplementation((uid: string) =>
        uid === 'u1' ? a.promise : Promise.resolve(userDoc({ email: 'u2@example.com' })),
      );
      await signInAs(user);
      await signInAs(userB);
      await waitFor(() => expect(status()).toBe('ready'));
      await act(async () => {
        a.reject(new AppError('NETWORK'));
      });
      expect(status()).toBe('ready');
      expect(screen.getByTestId('uid')).toHaveTextContent('u2');
    });
  });

  it('moves to signedOut when the session ends elsewhere (another tab signs out, US-1.2c)', async () => {
    mocks.getUserDoc.mockResolvedValue(userDoc());
    await signInAs(user);
    await waitFor(() => expect(status()).toBe('ready'));
    await signInAs(null);
    expect(status()).toBe('signedOut');
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });
});
