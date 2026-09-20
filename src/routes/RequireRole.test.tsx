import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RequireRole } from './RequireRole';

function renderGuard(role: Parameters<typeof RequireRole>[0]['role'], allow: Parameters<typeof RequireRole>[0]['allow']) {
  return render(
    <MemoryRouter>
      <RequireRole role={role} allow={allow}>
        <div>secret admin content</div>
      </RequireRole>
    </MemoryRouter>,
  );
}

describe('RequireRole (US-1.6d)', () => {
  it('renders children when the role is allowed', () => {
    renderGuard('ADMIN', ['ADMIN']);
    expect(screen.getByText('secret admin content')).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('denies STAFF when allowedRoles=[ADMIN]', () => {
    renderGuard('STAFF', ['ADMIN']);
    expect(screen.queryByText('secret admin content')).not.toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('denies MEMBER when allowedRoles=[ADMIN]', () => {
    renderGuard('MEMBER', ['ADMIN']);
    expect(screen.queryByText('secret admin content')).not.toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('denies an unknown (null) role', () => {
    renderGuard(null, ['ADMIN']);
    expect(screen.queryByText('secret admin content')).not.toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('supports multiple allowed roles so Staff screens can be added later', () => {
    renderGuard('STAFF', ['ADMIN', 'STAFF']);
    expect(screen.getByText('secret admin content')).toBeInTheDocument();
  });

  it('denies everything when allow is empty', () => {
    renderGuard('ADMIN', []);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
});
