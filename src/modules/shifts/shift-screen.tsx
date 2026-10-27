'use client';
import { useState } from 'react';
import { Clock3, Wallet, CircleCheck } from 'lucide-react';
import { useRemote } from '@/hooks/use-remote';
import { request, errorMessage } from '@/lib/client';
import { dateTime, money, toCents } from '@/lib/format';
import { shiftNames, paymentNames, type Shift } from '@/lib/types';
import { soldItems } from '@/modules/sales/summary';
import { OperationDetail } from '@/modules/sales/operation-detail';
export function ShiftScreen() {
  const remote = useRemote<Shift>('shifts/current');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<Shift | null>(null);
  const shift = remote.data;
  const payments = shift?.totals || { CASH: 0, MP: 0, CARD: 0 };
  async function send(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const result = await request<Shift>(path, 'POST', body);
      if (path.endsWith('close')) setClosed(result);
      await remote.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head">
        <p className="overline">Jornada de trabajo</p>
        <h1>Tu turno, de principio a fin.</h1>
        <p className="muted">Abrí la caja y al terminar contá el efectivo.</p>
      </header>
      {(error || remote.error) && (
        <p className="error" role="alert">
          {error || remote.error}
        </p>
      )}
      {remote.loading ? (
        <p>Cargando turno…</p>
      ) : !shift ? (
        <div className="grid" style={{ maxWidth: 620 }}>
          {closed && (
            <div className="card stack">
              <CircleCheck color="var(--accent)" />
              <h2>Turno cerrado</h2>
              <p>
                Total cobrado:{' '}
                {money(
                  closed.operations
                    .filter((o) => o.type !== 'OWNER')
                    .reduce((s, o) => s + o.total, 0),
                )}{' '}
                · {closed.operations.filter((o) => o.type === 'SALE').length} ventas
              </p>
              <p>Efectivo esperado: {money(closed.expectedCash || 0)}</p>
              <p>Contado: {money(closed.countedCash || 0)}</p>
              <strong style={{ color: closed.difference === 0 ? 'var(--accent)' : 'var(--amber)' }}>
                Diferencia: {money(closed.difference || 0)}
              </strong>
              <details>
                <summary>Productos vendidos</summary>
                {soldItems(closed.operations).map((p) => (
                  <p key={p.name}>
                    {p.quantity} × {p.name} · {money(p.subtotal)}
                  </p>
                ))}
              </details>
            </div>
          )}
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void send('shifts/open', {
                type: d.get('type'),
                openingCash: toCents(String(d.get('openingCash'))),
              });
            }}
          >
            <Clock3 size={28} />
            <h2>Empezar un turno</h2>
            <label>
              Turno
              <select name="type">
                <option value="MORNING">Mañana · 06 a 14</option>
                <option value="AFTERNOON">Tarde · 14 a 22</option>
                <option value="NIGHT">Noche · 22 a 06</option>
              </select>
            </label>
            <label>
              Efectivo inicial en caja ($)
              <input
                name="openingCash"
                type="number"
                min="0"
                step="0.01"
                required
                placeholder="Ingresá lo que hay en caja"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Abriendo…' : 'Abrir turno'}
            </button>
          </form>
        </div>
      ) : (
        <div className="stack">
          <div className="card row between">
            <div>
              <h2>{shiftNames[shift.type]}</h2>
              <small>Abierto {dateTime(shift.openedAt)}</small>
            </div>
            <span className="pill">● En curso</span>
          </div>
          <div className="grid stats">
            <div className="card">
              <p className="muted">Total vendido en el turno</p>
              <strong className="stat-value">
                {money(
                  shift.saleTotal ??
                    shift.operations
                      .filter((o) => o.type === 'SALE')
                      .reduce((sum, o) => sum + o.total, 0),
                )}
              </strong>
            </div>
            {Object.entries(payments).map(([method, amount]) => (
              <div className="card" key={method}>
                <p className="muted">{paymentNames[method as keyof typeof payments]}</p>
                <strong className="stat-value">{money(amount)}</strong>
              </div>
            ))}
            <div className="card">
              <p className="muted">Caja inicial</p>
              <strong className="stat-value">{money(shift.openingCash)}</strong>
            </div>
          </div>
          <details className="card" open>
            <summary>
              <strong>
                Este turno · {shift.operations.length} operaciones · más recientes primero
              </strong>
            </summary>
            {shift.operations.map((o) => (
              <div className="cart-line" key={o.id}>
                <div className="row between">
                  <strong>{money(o.total)}</strong>
                  <small>{dateTime(o.createdAt)}</small>
                </div>
                <small>
                  {o.type === 'EMPLOYEE'
                    ? 'Consumo de empleado'
                    : o.type === 'OWNER'
                      ? 'Retiro del dueño'
                      : 'Venta'}{' '}
                  ·{' '}
                  {o.payments
                    .map((p) => `${paymentNames[p.method]} ${money(p.amount)}`)
                    .join(' + ')}
                </small>
                <OperationDetail operation={o} />
              </div>
            ))}
            {!shift.operations.length && (
              <p className="empty">Todavía no hay ventas en este turno.</p>
            )}
          </details>
          <form
            className="card stack"
            style={{ maxWidth: 620 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm('¿Cerrar tu turno con este efectivo contado?')) {
                const d = new FormData(e.currentTarget);
                void send('shifts/close', { countedCash: toCents(String(d.get('countedCash'))) });
              }
            }}
          >
            <Wallet size={28} />
            <h2>Cerrar caja</h2>
            <p className="muted">
              Contá el efectivo físico. El cierre considera todas las operaciones del turno.
            </p>
            <label>
              Efectivo contado ($)
              <input name="countedCash" type="number" min="0" step="0.01" required />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Cerrando…' : 'Cerrar turno y ver diferencia'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
