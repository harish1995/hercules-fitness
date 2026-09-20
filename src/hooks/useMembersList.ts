import { listMembers } from '../services/memberService';
import { type Member, type MemberListQuery } from '../types/member';
import { usePagedList, type PagedListState } from './usePagedList';

export type MembersListState = PagedListState<Member>;

/** Server-side cursor pagination over `listMembers`; a new query (serialized as the key) resets to page 1. */
export function useMembersList(query: MemberListQuery): MembersListState {
  return usePagedList<Member>((cursor) => listMembers(query, cursor), JSON.stringify(query));
}
