import Button from '@mui/material/Button';
import { type ReactNode } from 'react';
import { ErrorState } from '../components/feedback/ErrorState';
import { FullPageLoader } from '../components/feedback/FullPageLoader';
import { useAuth } from '../hooks/useAuth';
import { NoAccessPage } from '../pages/NoAccessPage';

/**
 * Wraps the whole route tree and owns the blocking auth states so that no route, public or
 * protected, renders while the session/role is unresolved or refused:
 *   initialising / roleLoading -> loader (never a flash of /login, US-1.2a)
 *   roleError                  -> retryable error, no protected UI (US-1.6c)
 *   noAccess                   -> "You do not have access to this application" (US-1.6b)
 * Only signedOut and ready fall through to the routes.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, retryRole, signOut } = useAuth();

  switch (state.status) {
    case 'initialising':
      return <FullPageLoader label="Loading…" />;
    case 'roleLoading':
      return <FullPageLoader label="Checking your access…" />;
    case 'roleError':
      return (
        <ErrorState
          title="Could not verify your access"
          message={state.message}
          onRetry={retryRole}
          extraAction={
            <Button
              onClick={() => {
                void signOut();
              }}
            >
              Sign out
            </Button>
          }
        />
      );
    case 'noAccess':
      return <NoAccessPage />;
    case 'signedOut':
    case 'ready':
      return <>{children}</>;
  }
}
