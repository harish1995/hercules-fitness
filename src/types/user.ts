import { type Role } from '../constants/roles';

/** users/{uid}: created by hand in the Firebase console. Never written by the app (§3.1). */
export interface UserDoc {
  email: string;
  displayName: string;
  role: Role;
  /** false => treated as no access */
  active: boolean;
  /** set only for MEMBER logins (future) */
  memberDocId?: string;
  /** Converted from the Firestore Timestamp in userService (epoch 0 when absent or malformed). */
  createdAt: Date;
}

/** The signed-in Firebase identity, reduced to what the UI needs. */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}
