import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { diagnoseUserDoc, evaluateAccess } from '../domain/access';
import * as authService from '../services/authService';
import { mapFirebaseError } from '../services/errors';
import { getUserDoc } from '../services/userService';
import { type AppUser } from '../types';
import { warnLoginRefused } from '../utils/devDiagnostics';
import { AuthContext, type AuthContextValue, type AuthState } from './authState';

type SetAuthState = Dispatch<SetStateAction<AuthState>>;

/**
 * Show the refusal first, then sign out. The resulting signed-out auth event must not overwrite
 * the message (see the null-user branch in AuthProvider).
 */
async function refuse(setState: SetAuthState): Promise<void> {
  setState({ status: 'noAccess' });
  try {
    await authService.signOutUser();
  } catch {
    // Even if sign-out fails the state stays noAccess, so no protected UI is reachable.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'initialising' });
  // Monotonic token: a role lookup result is applied only if it is still the latest one, so a
  // quick sign-out / sign-in cannot be overwritten by a stale response.
  const lookupToken = useRef(0);
  const currentUser = useRef<AppUser | null>(null);

  const resolveRole = useCallback(async (user: AppUser) => {
    const token = ++lookupToken.current;
    setState({ status: 'roleLoading', user });
    try {
      const userDoc = await getUserDoc(user.uid);
      if (token !== lookupToken.current) return;
      const access = evaluateAccess(userDoc);
      if (access.granted) {
        setState({ status: 'ready', user, role: access.role });
        return;
      }
      // A null doc was already explained (missing / malformed) by userService; a well-formed doc that is
      // still refused (inactive, role without a UI) is explained here. Development builds only.
      if (userDoc) warnLoginRefused(() => diagnoseUserDoc(userDoc));
      await refuse(setState);
    } catch (e) {
      if (token !== lookupToken.current) return;
      const error = mapFirebaseError(e);
      if (error.kind === 'PERMISSION_DENIED') {
        // Rules refused the read of our own users doc: same outcome as "no access".
        warnLoginRefused(() => ({ reason: 'PERMISSION_DENIED', fieldTypes: {} }));
        await refuse(setState);
      } else {
        // Network/unavailable/unknown: the role is unknown, so render no protected UI and offer retry (US-1.6c).
        setState({ status: 'roleError', user, message: error.userMessage });
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = authService.observeAuth((user) => {
      currentUser.current = user;
      if (!user) {
        lookupToken.current++; // invalidate any in-flight lookup
        setState((prev) => (prev.status === 'noAccess' ? prev : { status: 'signedOut' }));
        return;
      }
      void resolveRole(user);
    });
    return unsubscribe;
  }, [resolveRole]);

  const retryRole = useCallback(() => {
    if (currentUser.current) void resolveRole(currentUser.current);
  }, [resolveRole]);

  const acknowledgeNoAccess = useCallback(() => {
    setState((prev) => (prev.status === 'noAccess' ? { status: 'signedOut' } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'ready' ? state.user : null,
      role: state.status === 'ready' ? state.role : null,
      signIn: authService.signIn,
      signOut: authService.signOutUser,
      sendPasswordReset: authService.sendReset,
      retryRole,
      acknowledgeNoAccess,
    }),
    [state, retryRole, acknowledgeNoAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
