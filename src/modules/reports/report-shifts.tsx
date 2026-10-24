'use client';
import { useState } from 'react';
import { dateTime, money } from '@/lib/format';
import { shiftNames, type Shift } from '@/lib/types';
import { request, errorMessage } from '@/lib/client';
export function ReportShifts({
  shifts,
  refresh,
}: {
  shifts: Shift[];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="report-card shift-report">
      <h2>Por turno</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="shift-table-head">
        <span>TURNO · EMPLEADO</span>
        <span>VENTAS</span>
        <span>EFECTIVO</span>
        <span>MP</span>
        <span>TARJETA</span>
        <span>TOTAL</span>
        <span>CAJA</span>
      </div>
      {shifts.map((s) => {
        const payments = { CASH: 0, MP: 0, CARD: 0 };
        for (const p of s.operations.flatMap((o) => o.payments)) payments[p.method] += p.amount;
        return (
          <details className="shift-report-row" key={s.id}>
            <summary>
              <span>
                <strong>
                  {shiftNames[s.type]} · {s.user?.name}
                </strong>
                <small>
                  {dateTime(s.openedAt)} →{' '}
                  {s.closedAt
                    ? dateTime(s.closedAt)
                    : s.archived
                      ? 'abierto en la copia'
                      : 'en curso'}
                </small>
              </span>
              <span>
                {s.operations.filter((o) => o.type === 'SALE').length}
                <small className="mobile-cell-label">ventas</small>
              </span>
              <span className="cash-color">
                {money(payments.CASH)}
                <small className="mobile-cell-label">Efectivo</small>
              </span>
              <span className="mp-color">
                {money(payments.MP)}
                <small className="mobile-cell-label">MP</small>
              </span>
              <span className="card-color">
                {money(payments.CARD)}
                <small className="mobile-cell-label">Tarjeta</small>
              </span>
              <strong>
                {money(
                  s.operations
                    .filter((o) => o.type !== 'OWNER')
                    .reduce((sum, o) => sum + o.total, 0),
                )}
              </strong>
              <span className={s.closedAt ? 'cash-color' : 'amber-color'}>
                {s.archived
                  ? 'Histórico'
                  : s.closedAt
                    ? s.difference === 0
                      ? '✓ Cerró'
                      : `Dif. ${money(s.difference || 0)}`
                    : 'En curso'}{' '}
                ⌄
              </span>
            </summary>
            <div className="shift-expanded">
              <p>
                Caja inicial {money(s.openingCash)}
                {!s.archived &&
                  s.closedAt &&
                  ` · Esperado ${money(s.expectedCash || 0)} · Contado ${money(s.countedCash || 0)}`}
                {s.archived &&
                  s.countedCash !== null &&
                  ` · Cierre registrado: ${money(s.countedCash)}`}
              </p>
              {s.archived && (
                <p className="note">
                  Turno histórico de consulta. No se vuelve a descontar stock. El archivo no incluye
                  todos los movimientos necesarios para conciliar la caja anterior.
                </p>
              )}
              {s.operations.map((o) => (
                <div className="cart-line" key={o.id}>
                  <div className="row between">
                    <strong>
                      {o.type === 'OWNER'
                        ? 'Retiro'
                        : o.type === 'EMPLOYEE'
                          ? 'Consumo empleado'
                          : 'Venta'}{' '}
                      · {money(o.total)}
                    </strong>
                    {!o.historical && (
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          const reason = window.prompt('Motivo de la anulación:');
                          if (!reason) return;
                          setBusy(true);
                          setError('');
                          try {
                            await request(`sales/${o.id}/void`, 'POST', { reason });
                            await refresh();
                          } catch (e) {
                            setError(errorMessage(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Anular
                      </button>
                    )}
                  </div>
                  <small>{dateTime(o.createdAt)}</small>
                  {o.historical && o.note && <small>{o.note}</small>}
                  {!!o.unallocatedPayment && (
                    <p className="muted">Mixto sin desglose: {money(o.unallocatedPayment)}</p>
                  )}
                  <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
                </div>
              ))}
              {!s.operations.length && <p className="muted">Sin movimientos.</p>}
            </div>
          </details>
        );
      })}
      {!shifts.length && <p className="empty">No hay turnos en este período.</p>}
    </section>
  );
}
