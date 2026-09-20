import { Alert } from '@mui/material';
import { clockSkewWarning } from '../../domain/clockSkew';

/**
 * Persistent warning (no close button on purpose: it stays until the clock is fixed and the page reloaded) shown when the device
 * clock differs from the server by more than 5 minutes (architecture 6.6, R-3). Renders nothing otherwise.
 */
export function ClockSkewBanner({ skewMs }: { skewMs: number | null }) {
  const message = clockSkewWarning(skewMs);
  if (message === null) return null;
  return (
    <Alert severity="warning" role="alert" sx={{ mb: 2 }}>
      {message}
    </Alert>
  );
}
