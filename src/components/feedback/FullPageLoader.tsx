import { Box, CircularProgress, Typography } from '@mui/material';

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
