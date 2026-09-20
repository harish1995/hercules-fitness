import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('is an accessible status region with the default and a custom label', () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    rerender(<LoadingState label="Loading members…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading members…');
  });
});

describe('EmptyState', () => {
  it('shows title, optional description and optional action', () => {
    render(<EmptyState title="No members yet" description="Register your first member." action={<button>Add</button>} />);
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(screen.getByText('Register your first member.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('omits description and action when not given', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('announces the message as an alert with a default title and no retry when onRetry is absent', () => {
    render(<ErrorState message="Network error. Check your internet connection and try again." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent('Network error. Check your internet connection');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onRetry when the retry button is clicked, and supports a custom label and extra action', async () => {
    const onRetry = vi.fn();
    const onOther = vi.fn();
    render(
      <ErrorState
        title="Could not load"
        message="Try later."
        onRetry={onRetry}
        retryLabel="Reload"
        extraAction={<button onClick={onOther}>Sign out</button>}
      />,
    );
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onOther).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
