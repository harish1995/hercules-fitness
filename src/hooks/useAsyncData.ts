import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'loading' | 'success' | 'error';

export interface AsyncData<T> {
  status: AsyncStatus;
  /** Last successful value (kept while a reload is in flight so the screen does not flash empty). */
  data: T | undefined;
  error: unknown;
  reload: () => void;
}

/**
 * Load data for a screen with stale-response protection: every request carries a token made of `key` and a reload
 * counter, and a result is applied only if its token is still current, so a slow earlier response can never overwrite
 * a newer one (US-2.8e). Change `key` to reload for new inputs; call `reload()` to retry.
 */
export function useAsyncData<T>(loader: () => Promise<T>, key: string): AsyncData<T> {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<{ token: string; data?: T; error?: unknown; failed: boolean } | null>(null);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const token = `${key}#${reloadCount}`;
  useEffect(() => {
    let cancelled = false;
    loaderRef.current().then(
      (data) => {
        if (!cancelled) setResult({ token, data, failed: false });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ token, error, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  const settled = result?.token === token;
  return {
    status: !settled ? 'loading' : result.failed ? 'error' : 'success',
    data: result?.data,
    error: settled ? result.error : undefined,
    reload,
  };
}
