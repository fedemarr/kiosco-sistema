'use client';
import { useCallback, useEffect, useState } from 'react';
import { request, errorMessage } from '@/lib/client';
export function useRemote<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    try {
      const value = await request<T>(path);
      setData(value);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 100);
    const interval = setInterval(() => void refresh(), 15000);
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
