import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../constants/routes';

/** Shown by RequireRole when a signed-in user's role is not allowed on a route (US-1.6d). */
export function AccessDeniedPage() {
  return (
    <Box role="alert" sx={{ py: 8, textAlign: 'center' }}>
      <LockOutlinedIcon color="disabled" sx={{ fontSize: 56 }} />
      <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
        Access denied
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        You do not have permission to view this page.
      </Typography>
      <Button component={RouterLink} to={ROUTES.dashboard} variant="contained" sx={{ mt: 3 }}>
        Go to dashboard
      </Button>
    </Box>
  );
}
