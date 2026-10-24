'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '@/lib/client';
export function useRemote<T>(path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path: null, data: null, error: '', loading: true });
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    if (!path) {
      setState({ path, data: null, error: '', loading: false });
      return;
    }
    try {
      const value = await request<T>(path);
      if (current === version.current) setState({ path, data: value, error: '', loading: false });
    } catch (e) {
      if (current === version.current)
        setState((old) => ({
          path,
          data: old.path === path ? old.data : null,
          error: errorMessage(e),
          loading: false,
        }));
    }
  }, [path]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 100);
    const interval = setInterval(() => void refresh(), 15000);
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', focus);
    window.addEventListener('stock-change', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', focus);
      window.removeEventListener('stock-change', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : '',
    loading: path !== state.path ? !!path : state.loading,
    refresh,
  };
}
