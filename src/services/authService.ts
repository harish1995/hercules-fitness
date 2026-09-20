import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase/app';
import { type AppUser } from '../types';
import { mapFirebaseError } from './errors';

function toAppUser(user: User): AppUser {
  return { uid: user.uid, email: user.email, displayName: user.displayName };
}

/** Email/password sign-in. Throws AppError (never a raw Firebase error). */
export async function signIn(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

/** Sends a password-reset email through Firebase (hosted reset page). Throws AppError. */
export async function sendReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

/**
 * Subscribe to auth state. Fires in every tab, so signing out elsewhere redirects here too
 * (US-1.2c). Returns the unsubscribe function.
 */
export function observeAuth(callback: (user: AppUser | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => callback(user ? toAppUser(user) : null));
}
