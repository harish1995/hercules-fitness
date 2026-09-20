import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageLoader } from '../components/feedback/FullPageLoader';
import { NEXT_PARAM } from '../constants/routes';
import { useAuth } from '../hooks/useAuth';
import { buildLoginRedirect } from './nextPath';

/**
 * Requires a resolved, admitted session. Signed-out visitors are redirected to /login and the
 * requested path is remembered (US-1.5). While the session or role is still resolving nothing
 * protected renders (US-1.2a, US-1.6c); AuthGate shows the user-facing screens for those states.
 */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'signedOut') {
    return (
      <Navigate to={buildLoginRedirect(location.pathname + location.search, NEXT_PARAM)} replace />
    );
  }
  if (state.status === 'ready') return <Outlet />;
  return <FullPageLoader />;
}
