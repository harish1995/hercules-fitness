import { db } from '../firebase/app';
import { type Clock } from '../domain/dates';
import {
  type Actor,
  type DuplicateMemberInfo,
  type Member,
  type MemberListQuery,
  type Page,
  type PageCursor,
  type RegisterMemberInput,
  type UpdateMemberInput,
} from '../types/member';
import { getMemberById, listExpiredPage, listExpiringPage, listMembersPage } from './memberQueries';
import {
  findMemberByMobileTx,
  newMemberDocId,
  registerMemberTx,
  softDeleteMemberTx,
  updateMemberTx,
  type RegisteredMember,
  type UpdateResult,
} from './memberTransactions';

/**
 * App-facing member API: binds the transaction and query modules to the app's Firestore instance.
 * (The bound modules take `db` so the same code runs in the emulator tests.) Pages and hooks import from here.
 */

export type { RegisteredMember, UpdateResult };

export function generateMemberDocId(): string {
  return newMemberDocId(db);
}

export function registerMember(params: {
  memberDocId: string;
  input: RegisterMemberInput;
  actor: Actor;
  hasPhoto?: boolean;
  duplicateMobileConfirmed?: boolean;
  clock?: Clock;
}): Promise<RegisteredMember> {
  return registerMemberTx({ db, ...params });
}

export function updateMember(params: {
  memberDocId: string;
  expectedVersion: string;
  currentMobile: string;
  input: UpdateMemberInput;
  actor: Actor;
  duplicateMobileConfirmed?: boolean;
}): Promise<UpdateResult> {
  return updateMemberTx({ db, ...params });
}

export function softDeleteMember(params: { memberDocId: string; actor: Actor }): Promise<void> {
  return softDeleteMemberTx({ db, ...params });
}

export function getMember(memberDocId: string): Promise<Member | null> {
  return getMemberById(db, memberDocId);
}

export function listMembers(query: MemberListQuery, cursor: PageCursor | null = null): Promise<Page<Member>> {
  return listMembersPage(db, query, cursor);
}

export function listExpiringMembers(days: number, cursor: PageCursor | null, today: Date): Promise<Page<Member>> {
  return listExpiringPage(db, days, cursor, today);
}

export function listExpiredMembers(cursor: PageCursor | null, today: Date): Promise<Page<Member>> {
  return listExpiredPage(db, cursor, today);
}

/** The member to name in the duplicate-mobile warning (a live one first, else a soft-deleted one), or null. */
export function findMemberByMobile(
  mobile: string,
  role: Actor['role'],
  ignoreMemberDocId?: string,
): Promise<DuplicateMemberInfo | null> {
  return findMemberByMobileTx(db, mobile, role, ignoreMemberDocId);
}
