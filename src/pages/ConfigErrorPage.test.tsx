import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../config/env';
import { ConfigErrorPage } from './ConfigErrorPage';

describe('ConfigErrorPage (US-1.8b)', () => {
  it('announces the problem and names every missing key', () => {
    render(<ConfigErrorPage missingKeys={['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Application is not configured');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']);
    expect(screen.getByText('.env.example')).toBeInTheDocument();
  });

  it('prints key names only, never the values of other keys (real readConfig -> page)', () => {
    const SECRET = 'AIzaSy-DISTINCTIVE-SECRET-9f8e7d6c';
    const result = readConfig(
      {
        VITE_FIREBASE_API_KEY: SECRET,
        VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'demo-project',
        VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
        VITE_FIREBASE_APP_ID: '',
      },
      false,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { container } = render(<ConfigErrorPage missingKeys={result.error.missingKeys} />);
    expect(screen.getByText('VITE_FIREBASE_APP_ID')).toBeInTheDocument();
    expect(screen.queryByText('VITE_FIREBASE_API_KEY')).not.toBeInTheDocument(); // present, so not listed
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).not.toContain('demo-project');
  });
});
