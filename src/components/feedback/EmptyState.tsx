import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { Box, Typography } from '@mui/material';
import { type ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
      <InboxOutlinedIcon sx={{ fontSize: 48, mb: 1 }} />
      <Typography variant="h6" color="text.primary">
        {title}
      </Typography>
      {description && <Typography variant="body2">{description}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}
