import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_ENV_KEYS } from './config/env';

// A stand-in for the real App. Its factory runs only if main.tsx actually imports './App', which is
// exactly what must NOT happen (and so must not pull in Firebase) when configuration is invalid.
const appLoaded = vi.hoisted(() => vi.fn());
vi.mock('./App', () => {
  appLoaded();
  return { default: () => <div>APP STUB</div> };
});

const SECRET = 'AIzaSy-DISTINCTIVE-SECRET-9f8e7d6c';

function stubEnv(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    VITE_FIREBASE_API_KEY: SECRET,
    VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-project',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
    VITE_FIREBASE_APP_ID: '1:123:web:abc',
    ...overrides,
  };
  for (const key of REQUIRED_ENV_KEYS) vi.stubEnv(key, values[key] ?? '');
}

async function boot() {
  vi.resetModules();
  await import('./main');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  appLoaded.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('main.tsx bootstrap (US-1.8b)', { timeout: 20_000 }, () => {
  it('with a missing key it renders the configuration screen naming the key and never loads the App/Firebase', async () => {
    stubEnv({ VITE_FIREBASE_APP_ID: '' });
    await boot();
    expect(await screen.findByText('Application is not configured')).toBeInTheDocument();
    expect(screen.getByText('VITE_FIREBASE_APP_ID')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET); // values of other keys are not printed
    expect(screen.queryByText('APP STUB')).not.toBeInTheDocument();
    expect(appLoaded).not.toHaveBeenCalled();
  });

  it('with complete configuration it lazily loads and renders the App, not the error screen', async () => {
    stubEnv();
    await boot();
    expect(await screen.findByText('APP STUB')).toBeInTheDocument();
    expect(screen.queryByText('Application is not configured')).not.toBeInTheDocument();
    await waitFor(() => expect(appLoaded).toHaveBeenCalledTimes(1));
  });
});
