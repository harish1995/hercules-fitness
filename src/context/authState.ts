import { createContext } from 'react';
import { type Role } from '../constants/roles';
import { type AppUser } from '../types';

/** The state machine from architecture §4.1. */
export type AuthState =
  | { status: 'initialising' } // waiting for Firebase to restore the session: never flash /login
  | { status: 'signedOut' }
  | { status: 'roleLoading'; user: AppUser }
  | { status: 'roleError'; user: AppUser; message: string } // retryable, no protected UI
  | { status: 'noAccess' } // refused (no/inactive/unknown/unsupported role); user has been signed out
  | { status: 'ready'; user: AppUser; role: Role };

export interface AuthContextValue {
  state: AuthState;
  /** Convenience accessors, null unless status === 'ready'. */
  user: AppUser | null;
  role: Role | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Re-run the role lookup after a network error. */
  retryRole: () => void;
  /** Leave the "no access" screen and return to sign-in. */
  acknowledgeNoAccess: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
