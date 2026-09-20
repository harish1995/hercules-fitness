import { createContext } from 'react';

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

export interface ToastContextValue {
  showToast: (message: string, severity?: ToastSeverity) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
