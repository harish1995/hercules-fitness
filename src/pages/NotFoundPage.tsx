import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../constants/routes';

export function NotFoundPage() {
  return (
    <Box sx={{ py: 8, textAlign: 'center' }}>
      <Typography variant="h3" component="p" color="text.secondary">
        404
      </Typography>
      <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
        Page not found
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        The page you are looking for does not exist.
      </Typography>
      <Button component={RouterLink} to={ROUTES.dashboard} variant="contained" sx={{ mt: 3 }}>
        Go to dashboard
      </Button>
    </Box>
  );
}
