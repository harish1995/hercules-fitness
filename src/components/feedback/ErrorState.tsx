import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import { Box, Button, Typography } from '@mui/material';
import { type ReactNode } from 'react';

interface ErrorStateProps {
  /** A user-safe message (use toUserMessage(error)); never a raw error. */
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  extraAction?: ReactNode;
}

export function ErrorState({
  message,
  title = 'Something went wrong',
  onRetry,
  retryLabel = 'Try again',
  extraAction,
}: ErrorStateProps) {
  return (
    <Box role="alert" sx={{ py: 6, textAlign: 'center' }}>
      <ErrorOutlinedIcon color="error" sx={{ fontSize: 48, mb: 1 }} />
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {message}
      </Typography>
      <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center' }}>
        {onRetry && (
          <Button variant="contained" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {extraAction}
      </Box>
    </Box>
  );
}
