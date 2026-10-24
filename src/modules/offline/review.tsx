'use client';
import { useState } from 'react';
import { useRemote } from '@/hooks/use-remote';
import { request, errorMessage } from '@/lib/client';
import { money, dateTime } from '@/lib/format';
import type { CheckoutInput } from '@/modules/sales/schema';
type Conflict = {
  key: string;
  createdAt: string;
  message: string;
  payload: CheckoutInput;
  user: { name: string };
};
export function OfflineReview() {
  const remote = useRemote<Conflict[]>('offline-conflicts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!remote.data?.length && !remote.error) return null;
  return (
    <div className="card stack toolbar">
      <h2>Cobros offline para revisar · {remote.data?.length || 0}</h2>
      <p className="muted">
        Estos cobros no se registraron. Revisá con el empleado lo cobrado y resolvé la diferencia
        antes de marcarlos como revisados.
      </p>
      {(error || remote.error) && (
        <p className="error" role="alert">
          {error || remote.error}
        </p>
      )}
      {remote.data?.map((c) => (
        <div className="cart-line stack" key={c.key}>
          <div className="row between">
            <strong>
              {c.user.name} · {money(c.payload.payments.reduce((s, p) => s + p.amount, 0))}
            </strong>
            <small>{dateTime(c.createdAt)}</small>
          </div>
          <p className="note">{c.message}</p>
          <small>
            Referencia {c.key.slice(0, 8)} · {c.payload.items.reduce((s, i) => s + i.quantity, 0)}{' '}
            unidades
          </small>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await request(`offline-conflicts/${c.key}`, 'PATCH', {
                  resolution: data.get('resolution'),
                });
                await remote.refresh();
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Cómo se resolvió
              <input
                name="resolution"
                minLength={5}
                maxLength={1000}
                placeholder="Ej.: se devolvió el importe al cliente"
                required
              />
            </label>
            <button disabled={busy}>Guardar revisión (sin registrar otra venta)</button>
          </form>
        </div>
      ))}
    </div>
  );
}
