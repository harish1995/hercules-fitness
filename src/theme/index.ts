import { createTheme } from '@mui/material/styles';

/**
 * MUI theme. Desktop-first, compact tables (data-heavy admin screens), no external web fonts
 * (nothing to load from third parties). Dates are formatted DD/MM/YYYY by the domain layer,
 * not by the theme.
 */
export const theme = createTheme({
  palette: {
    primary: { main: '#1b3a57' },
    secondary: { main: '#e0762d' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: [
      'system-ui',
      '-apple-system',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiTable: { defaultProps: { size: 'small' } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600 } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
  },
});
