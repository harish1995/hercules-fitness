import { Box } from '@mui/material';
import { type ReactNode } from 'react';

const VISUALLY_HIDDEN = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

interface AccessibleChartProps {
  /** e.g. "New members by month" */
  label: string;
  /** The chart's data as text, so a screen reader (or anyone who cannot see the graphic) gets the same numbers. */
  rows: { label: string; value: number }[];
  valueLabel: string;
  children: ReactNode;
}

/**
 * A text alternative for a chart: the graphic is hidden from assistive technology and the same figures are exposed as a
 * visually hidden table inside a labelled figure (WCAG 1.1.1). The chart libraries render SVG that a screen reader cannot
 * summarise on its own.
 */
export function AccessibleChart({ label, rows, valueLabel, children }: AccessibleChartProps) {
  return (
    <Box role="figure" aria-label={label} sx={{ position: 'relative' }}>
      <Box aria-hidden="true">{children}</Box>
      <Box component="table" sx={VISUALLY_HIDDEN}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
