import { Box, CircularProgress, Typography } from '@mui/material';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}
    >
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
