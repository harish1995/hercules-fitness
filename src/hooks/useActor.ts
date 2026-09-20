import { useMemo } from 'react';
import { type Actor } from '../types/member';
import { useAuth } from './useAuth';

/**
 * The signed-in user as the audit/consent "actor" (uid, display name, role). Null unless the role is ADMIN or STAFF
 * (a MEMBER never performs staff actions). The name falls back to the email, then the uid, so an audit record is
 * never anonymous.
 */
export function useActor(): Actor | null {
  const { user, role } = useAuth();
  return useMemo(() => {
    if (!user || (role !== 'ADMIN' && role !== 'STAFF')) return null;
    return { uid: user.uid, name: user.displayName ?? user.email ?? user.uid, role };
  }, [user, role]);
}
