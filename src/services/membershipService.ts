import { db } from '../firebase/app';
import { type Clock } from '../domain/dates';
import { type Actor, type Page, type PageCursor } from '../types/member';
import { type AssignedMembership, type Membership } from '../types/membership';
import { listMembershipsPageFor } from './membershipQueries';
import {
  assignMembershipTx,
  newMembershipDocId,
  renewMembershipTx,
  setSuspendedTx,
  type SuspendResult,
} from './membershipTransactions';

/** App-facing membership API (assign / renew / suspend / history), bound to the app's Firestore instance. */

export type { SuspendResult };

export const generateMembershipDocId = (): string => newMembershipDocId(db);

export const assignMembership = (params: {
  memberDocId: string;
  planId: string;
  membershipDocId: string;
  startDate: Date;
  actor: Actor;
  clock?: Clock;
}): Promise<AssignedMembership> => assignMembershipTx({ db, ...params });

export const renewMembership = (params: {
  memberDocId: string;
  planId: string;
  membershipDocId: string;
  actor: Actor;
  clock?: Clock;
}): Promise<AssignedMembership> => renewMembershipTx({ db, ...params });

export const setSuspended = (params: {
  memberDocId: string;
  suspend: boolean;
  reason?: string | null;
  actor: Actor;
}): Promise<SuspendResult> => setSuspendedTx({ db, ...params });

export const listMemberships = (memberDocId: string, cursor: PageCursor | null = null): Promise<Page<Membership>> =>
  listMembershipsPageFor(db, memberDocId, cursor);
