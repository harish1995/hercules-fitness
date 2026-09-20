import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClockSkewBanner } from './ClockSkewBanner';

describe('ClockSkewBanner', () => {
  it('renders nothing for a correct or unknown clock', () => {
    const { container, rerender } = render(<ClockSkewBanner skewMs={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ClockSkewBanner skewMs={4 * 60_000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a persistent alert (no dismiss button) when the clock is off by more than 5 minutes', () => {
    render(<ClockSkewBanner skewMs={-90 * 60_000} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/about 90 minutes behind/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
