import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readConfig } from './config/env';
import { ConfigErrorPage } from './pages/ConfigErrorPage';
import { theme } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
const root = createRoot(container);

// Validate configuration BEFORE anything imports Firebase. A missing VITE_* key renders a clear
// configuration screen naming the key instead of a blank page (US-1.8b). App (and therefore the
// Firebase SDK) is loaded lazily, only when configuration is valid.
const config = readConfig();

if (!config.ok) {
  root.render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ConfigErrorPage missingKeys={config.error.missingKeys} />
      </ThemeProvider>
    </StrictMode>,
  );
} else {
  void import('./App').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
