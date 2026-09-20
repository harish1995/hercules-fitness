import BlockIcon from '@mui/icons-material/Block';
import { Box, Button, Typography } from '@mui/material';
import { useAuth } from '../hooks/useAuth';

/**
 * Full-screen refusal for a user who authenticated but may not use the application (no users
 * doc, inactive, unknown role, or a role with no UI yet). The user has already been signed out
 * by AuthProvider (US-1.6b).
 */
export function NoAccessPage() {
  const { acknowledgeNoAccess } = useAuth();
  return (
    <Box
      role="alert"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        p: 3,
      }}
    >
      <BlockIcon color="error" sx={{ fontSize: 56 }} />
      <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
        You do not have access to this application
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420 }}>
        You have been signed out. If you believe this is a mistake, please contact the gym owner.
      </Typography>
      <Button variant="contained" sx={{ mt: 3 }} onClick={acknowledgeNoAccess}>
        Back to sign in
      </Button>
    </Box>
  );
}
