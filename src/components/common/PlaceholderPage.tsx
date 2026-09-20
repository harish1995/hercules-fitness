import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import { Box, Paper, Typography } from '@mui/material';
import { PageHeader } from './PageHeader';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

/** Stand-in for screens that ship in a later phase (US-1.7c): a normal page, not an error. */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
        <Box sx={{ color: 'text.secondary' }}>
          <ConstructionOutlinedIcon sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" color="text.primary">
            Coming in a later phase
          </Typography>
          <Typography variant="body2">{description ?? `${title} is not available yet.`}</Typography>
        </Box>
      </Paper>
    </>
  );
}
