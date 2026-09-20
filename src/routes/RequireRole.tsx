import { type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { type Role } from '../constants/roles';
import { isRoleAllowed } from '../domain/access';
import { useAuth } from '../hooks/useAuth';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';

interface RequireRoleProps {
  /** The resolved role of the current user (null when unknown => always denied). */
  role: Role | null;
  allow: readonly Role[];
  /** Defaults to <Outlet/> so it can wrap a group of routes. */
  children?: ReactNode;
}

/**
 * Pure role guard (US-1.6d): renders its children when `role` is in `allow`, otherwise the
 * access-denied screen. UI hiding is not security; Firestore rules are the real enforcement.
 */
export function RequireRole({ role, allow, children }: RequireRoleProps) {
  if (!isRoleAllowed(role, allow)) return <AccessDeniedPage />;
  return <>{children ?? <Outlet />}</>;
}

/** Route-tree wiring: reads the role from AuthContext. */
export function RoleRoute({ allow, children }: { allow: readonly Role[]; children?: ReactNode }) {
  const { role } = useAuth();
  return (
    <RequireRole role={role} allow={allow}>
      {children}
    </RequireRole>
  );
}
