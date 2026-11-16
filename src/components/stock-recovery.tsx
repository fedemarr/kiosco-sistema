'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pendingStockCommand,
  performStockCommand,
  type StockCommand,
  stockCommandInFlight,
} from '@/modules/stock/commands';
import { ApiError, errorMessage } from '@/lib/client';
export function StockRecovery({ userId }: { userId: string }) {
  const [pending, setPending] = useState<StockCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(true);
  const recovering = useRef(false);
  const generation = useRef(0);
  const paused = useRef<string | null>(null);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setOnline(navigator.onLine);
    const value = await pendingStockCommand(userId);
    if (current === generation.current) setPending(value);
    return value;
  }, [userId]);
  const recover = useCallback(
    async (command: StockCommand) => {
      if (recovering.current || stockCommandInFlight(userId) || !navigator.onLine) return;
      recovering.current = true;
      setBusy(true);
      setError('');
      try {
        await performStockCommand(userId, command);
        setMessage('Movimiento de stock confirmado. Se registró una sola vez.');
      } catch (e) {
        setError(errorMessage(e));
        if (
          e instanceof ApiError &&
          e.status &&
          e.status >= 400 &&
          e.status < 500 &&
          ![401, 403, 429].includes(e.status)
        )
          paused.current = command.requestKey;
      } finally {
        recovering.current = false;
        setBusy(false);
        await refresh().catch(() => {});
      }
    },
    [refresh, userId],
  );
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    let disposed = false;
    const update = () => {
      void refresh().catch(() => {});
    };
    const retry = () => {
      if (disposed || !navigator.onLine || recovering.current || stockCommandInFlight(userId))
        return;
      void refresh()
        .then((command) => {
          // Sumar mercadería es idempotente; un conteo pendiente exige revisión manual.
          if (!disposed && command?.type === 'RECEIPT' && paused.current !== command.requestKey)
            void recover(command);
        })
        .catch(() => {});
    };
    const timer = setTimeout(() => {
      update();
      retry();
    }, 0);
    const interval = setInterval(update, 5000);
    const retryTimer = setInterval(() => {
      if (!document.hidden) retry();
    }, 15000);
    const visible = () => {
      if (!document.hidden) retry();
    };
    window.addEventListener('stock-command-change', update);
    window.addEventListener('online', retry);
    window.addEventListener('offline', update);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      invalidate();
      clearTimeout(timer);
      clearInterval(interval);
      clearInterval(retryTimer);
      window.removeEventListener('stock-command-change', update);
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [invalidate, recover, refresh, userId]);
  if (!pending)
    return message ? (
      <p className="success" role="status">
        {message}
      </p>
    ) : error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <div className="note stack" style={{ marginBottom: 16 }}>
      <strong>Carga de stock pendiente de confirmación</strong>
      <span>
        {pending.productName} ·{' '}
        {pending.type === 'RECEIPT'
          ? `Sumar ${pending.quantity} unidades`
          : `Conteo: ${pending.quantity} unidades`}
      </span>
      <small>
        {pending.type === 'RECEIPT'
          ? 'La carga está guardada en este navegador. Se reintenta automáticamente con conexión y con la misma solicitud, sin sumar dos veces. Todavía no está confirmada por el servidor.'
          : 'El conteo no se aplica automáticamente: verificá el saldo antes de confirmar. La misma solicitud evita registrar dos veces un conteo ya guardado.'}
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || !online} onClick={() => void recover(pending)}>
        {busy ? 'Verificando…' : 'Confirmar estado de la carga'}
      </button>
    </div>
  );
}
