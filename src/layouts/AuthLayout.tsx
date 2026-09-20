import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { Box, Paper, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';

/** Centered card used by the public pages (login, forgot password). */
export function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 420 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 3 }}>
          <FitnessCenterIcon color="primary" />
          <Typography variant="h5" component="p" color="primary">
            Hercules Fitness
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Outlet />
        </Paper>
      </Box>
    </Box>
  );
}
