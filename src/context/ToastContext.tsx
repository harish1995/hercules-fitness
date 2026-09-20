import { Alert, Snackbar } from '@mui/material';
import { useCallback, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ToastContext, type ToastContextValue, type ToastSeverity } from './toastState';

interface ToastItem {
  key: number;
  message: string;
  severity: ToastSeverity;
}

const AUTO_HIDE_MS = 5000;

/** Snackbar queue: toasts show one at a time and auto-dismiss (US-1.10b). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [open, setOpen] = useState(false);
  const counter = useRef(0);

  const current = queue[0];

  const showToast = useCallback((message: string, severity: ToastSeverity = 'info') => {
    const key = counter.current++;
    setQueue((q) => [...q, { key, message, severity }]);
    setOpen(true);
  }, []);

  const handleClose = (_event?: SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const handleExited = () => {
    setQueue((q) => q.slice(1));
    setOpen(true);
  };

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (m) => showToast(m, 'success'),
      error: (m) => showToast(m, 'error'),
      info: (m) => showToast(m, 'info'),
      warning: (m) => showToast(m, 'warning'),
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key}
        open={open && current !== undefined}
        autoHideDuration={AUTO_HIDE_MS}
        onClose={handleClose}
        slotProps={{ transition: { onExited: handleExited } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleClose}
          severity={current?.severity ?? 'info'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}
