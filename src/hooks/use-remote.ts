'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '@/lib/client';
export function useRemote<T>(path: string | null, refreshInterval = 15000) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
    updatedAt: number | null;
  }>({ path: null, data: null, error: '', loading: true, updatedAt: null });
  const version = useRef(0);
  const active = useRef<{ path: string; version: number } | null>(null);
  const refresh = useCallback(async () => {
    if (path && active.current?.path === path) return;
    const current = ++version.current;
    if (!path) {
      setState({ path, data: null, error: '', loading: false, updatedAt: null });
      return;
    }
    active.current = { path, version: current };
    try {
      const value = await request<T>(path);
      if (current === version.current)
        setState({ path, data: value, error: '', loading: false, updatedAt: Date.now() });
    } catch (e) {
      if (current === version.current)
        setState((old) => ({
          path,
          data: old.path === path ? old.data : null,
          error: errorMessage(e),
          loading: false,
          updatedAt: old.path === path ? old.updatedAt : null,
        }));
    } finally {
      if (active.current?.version === current) active.current = null;
    }
  }, [path]);
  const cancel = useCallback(() => {
    version.current++;
    active.current = null;
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 100);
    const interval = setInterval(() => {
      if (!document.hidden && navigator.onLine) void refresh();
    }, refreshInterval);
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', focus);
    window.addEventListener('focus', focus);
    window.addEventListener('sale-confirmed', focus);
    window.addEventListener('stock-change', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      cancel();
      window.removeEventListener('online', focus);
      window.removeEventListener('focus', focus);
      window.removeEventListener('sale-confirmed', focus);
      window.removeEventListener('stock-change', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh, refreshInterval, cancel]);
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : '',
    loading: path !== state.path ? !!path : state.loading,
    refresh,
    updatedAt: state.path === path ? state.updatedAt : null,
  };
}
