'use client';
import { useEffect, useState } from 'react';
import {
  pendingStockCommand,
  performStockCommand,
  type StockCommand,
} from '@/modules/stock/commands';
import { errorMessage } from '@/lib/client';
export function StockRecovery({ userId }: { userId: string }) {
  const [pending, setPending] = useState<StockCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const refresh = () => {
      void pendingStockCommand(userId)
        .then(setPending)
        .catch(() => {});
    };
    const timer = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 5000);
    window.addEventListener('stock-command-change', refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('stock-command-change', refresh);
    };
  }, [userId]);
  if (!pending)
    return message ? (
      <p className="success" role="status">
        {message}
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
        Si se cortó la respuesta, esta comprobación conserva la misma solicitud y evita cargar dos
        veces.
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await performStockCommand(userId, pending);
            setMessage('Movimiento de stock confirmado. Se registró una sola vez.');
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Verificando…' : 'Confirmar estado de la carga'}
      </button>
    </div>
  );
}
