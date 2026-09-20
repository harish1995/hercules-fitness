import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import { Box, Typography } from '@mui/material';

interface ConfigErrorPageProps {
  missingKeys: readonly string[];
}

/**
 * Shown by main.tsx, BEFORE Firebase is initialised, when required VITE_* configuration is
 * missing or invalid (US-1.8b). Lists key names only, never values.
 */
export function ConfigErrorPage({ missingKeys }: ConfigErrorPageProps) {
  return (
    <Box
      role="alert"
      sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}
    >
      <Box sx={{ maxWidth: 560 }}>
        <SettingsSuggestIcon color="warning" sx={{ fontSize: 48 }} />
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          Application is not configured
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          The following configuration values are missing or invalid:
        </Typography>
        <Box component="ul" sx={{ fontFamily: 'monospace', pl: 3 }}>
          {missingKeys.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Firebase web app
          values (or set them in the Render dashboard and redeploy). See the README for details.
        </Typography>
      </Box>
    </Box>
  );
}
