import { Box, Card, CardContent, Typography } from '@mui/material';
import { type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  /** null = the figure does not exist yet: an en dash plus `hint`, never a misleading 0 (US-2.12b). */
  value: number | string | null;
  hint?: string;
  action?: ReactNode;
}

export function StatCard({ label, value, hint, action }: StatCardProps) {
  return (
    <Card component="section" aria-label={label}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" component="p" sx={{ my: 0.5 }} aria-label={value === null ? `${label}: not available yet` : undefined}>
          {value === null ? '–' : value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </CardContent>
    </Card>
  );
}
