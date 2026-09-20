import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '../hooks/useToast';
import { ToastProvider } from './ToastContext';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Member saved')}>ok</button>
      <button onClick={() => toast.error('Save failed')}>fail</button>
    </>
  );
}

// Advance in small steps, each inside its own act(): the exit-transition timer is only scheduled after
// React has committed the "closed" state, so one big jump would skip past it.
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) act(() => vi.advanceTimersByTime(100));
}

beforeEach(() => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider (US-1.10b)', () => {
  it('shows a toast when an action reports success and auto-dismisses it', () => {
    expect(screen.queryByText('Member saved')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByText('Member saved')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-colorSuccess');

    advance(4900);
    expect(screen.getByText('Member saved')).toBeInTheDocument(); // still visible just before the timeout

    advance(1000); // past 5000 ms, plus the exit transition
    expect(screen.queryByText('Member saved')).not.toBeInTheDocument();
  });

  it('shows failures as an error toast that also auto-dismisses', () => {
    fireEvent.click(screen.getByText('fail'));
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-colorError');
    advance(6000);
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
  });

  it('queues toasts: the second appears only after the first has been dismissed', () => {
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('fail'));
    expect(screen.getByText('Member saved')).toBeInTheDocument();
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();

    advance(6000);
    expect(screen.queryByText('Member saved')).not.toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();

    advance(6000);
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
  });

  it('can be dismissed early with the close button', () => {
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    advance(1000); // exit transition only, far below the 5000 ms auto-hide
    expect(screen.queryByText('Member saved')).not.toBeInTheDocument();
  });
});
