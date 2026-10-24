'use client';
import { useState } from 'react';
import { Download, TrendingUp, Wallet, ShoppingBasket, CircleDollarSign } from 'lucide-react';
import { useRemote } from '@/hooks/use-remote';
import { businessDate, money, dateTime } from '@/lib/format';
import { shiftNames, paymentNames, type Shift } from '@/lib/types';
import { request, errorMessage } from '@/lib/client';
import { OfflineReview } from '@/modules/offline/review';
type Report = {
  total: number;
  cost: number;
  profit: number;
  saleTotal: number;
  employeeTotal: number;
  saleCount: number;
  payments: { CASH: number; CARD: number; MP: number };
  top: { name: string; quantity: number; total: number }[];
  days: { day: string; total: number; profit: number }[];
  employees: { id: string; name: string; count: number; total: number; average: number }[];
  shifts: Shift[];
  lowStock: { id: string; name: string; stock: number; min_stock: number }[];
  pendingRequests: number;
  truncated: boolean;
};
export function ReportScreen() {
  const [from, setFrom] = useState(businessDate());
  const [to, setTo] = useState(businessDate());
  const [tab, setTab] = useState('overview');
  const [filter, setFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remote = useRemote<Report>(`reports?from=${from}&to=${to}`);
  const d = remote.data;
  function range(days: number) {
    const now = new Date();
    setTo(businessDate(now));
    setFrom(businessDate(new Date(now.getTime() - (days - 1) * 86400000)));
  }
  return (
    <>
      <header className="page-head row between">
        <div>
          <p className="overline">Administración</p>
          <h1>Los números de tu kiosco.</h1>
          <p className="muted">Ventas, caja y resultados, en un solo lugar.</p>
        </div>
        <a className="navlink" href={`/api/exports?kind=reports&from=${from}&to=${to}`} download>
          <Download size={18} />
          Exportar Excel
        </a>
      </header>
      <div className="card stack toolbar">
        <OfflineReview />
        <div className="fields">
          <label>
            Desde
            <input
              aria-label="Desde"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              aria-label="Hasta"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button onClick={() => range(1)}>Hoy</button>
          <button onClick={() => range(7)}>Últimos 7 días</button>
          <button onClick={() => range(30)}>Últimos 30 días</button>
        </div>
      </div>
      <div className="row toolbar">
        {[
          ['overview', 'Resumen'],
          ['shifts', 'Turnos'],
          ['employees', 'Empleados'],
        ].map(([id, label]) => (
          <button className={tab === id ? 'primary' : ''} key={id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {(remote.error || error) && (
        <p className="error" role="alert">
          {remote.error || error}
        </p>
      )}
      {remote.loading && <p>Cargando reportes…</p>}
      {d && (
        <>
          {d.truncated && (
            <p className="note">
              Este rango alcanzó el límite de 1.000 turnos. Reducí las fechas para ver totales
              completos.
            </p>
          )}
          {d.pendingRequests > 0 && (
            <p className="note">
              Hay {d.pendingRequests} solicitudes de acceso al stock. Resolvelas en Usuarios.
            </p>
          )}
          <div className="grid stats toolbar">
            {[
              { label: 'Cobrado', value: d.total, icon: Wallet },
              { label: 'Costo vendido', value: d.cost, icon: CircleDollarSign },
              { label: 'Ganancia', value: d.profit, icon: TrendingUp },
              { label: 'Ventas', value: d.saleCount, icon: ShoppingBasket },
            ].map((s, i) => (
              <div className="card" key={s.label}>
                <div className="row between">
                  <p className="muted">{s.label}</p>
                  <s.icon size={18} color="var(--muted)" />
                </div>
                <strong
                  className="stat-value"
                  style={{ color: i === 2 ? 'var(--accent)' : undefined }}
                >
                  {i === 3 ? s.value : money(s.value)}
                </strong>
              </div>
            ))}
          </div>
          <small>
            Consumo de empleados cobrado: {money(d.employeeTotal)} · Retiro del dueño separado de
            ventas. Ganancia según costos registrados.
          </small>
          {tab === 'overview' && (
            <div className="grid" style={{ marginTop: 20 }}>
              <div className="card stack">
                <h2>Por medio de pago</h2>
                {Object.entries(d.payments).map(([key, amount]) => (
                  <div key={key}>
                    <div className="row between">
                      <span>{paymentNames[key as keyof typeof paymentNames]}</span>
                      <strong>{money(amount)}</strong>
                    </div>
                    <div className="mini-chart" style={{ marginTop: 8 }}>
                      <span style={{ width: `${d.total ? (amount / d.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="card">
                <h2>Productos más vendidos</h2>
                {!d.top.length && <p className="empty">Todavía no hay ventas en este período.</p>}
                {d.top.map((p, i) => (
                  <div className="cart-line row between" key={p.name}>
                    <span>
                      <small>{String(i + 1).padStart(2, '0')} · </small>
                      {p.name}
                      <br />
                      <small>{p.quantity} unidades</small>
                    </span>
                    <strong>{money(p.total)}</strong>
                  </div>
                ))}
              </div>
              <div className="card">
                <h2>Evolución por día</h2>
                {d.days.map((day) => (
                  <div className="cart-line row between" key={day.day}>
                    <span>{day.day}</span>
                    <span>
                      {money(day.total)}
                      <br />
                      <small>Ganancia {money(day.profit)}</small>
                    </span>
                  </div>
                ))}
                <p className="muted" style={{ marginTop: 16 }}>
                  Proyección a 30 días:{' '}
                  {money(
                    Math.round(
                      (d.total /
                        Math.max(
                          1,
                          (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1,
                        )) *
                        30,
                    ),
                  )}
                  . Estimación según el promedio del rango.
                </p>
              </div>
              <div className="card">
                <h2>Stock para reponer</h2>
                {d.lowStock.map((p) => (
                  <div key={p.id} className="cart-line row between">
                    <span>{p.name}</span>
                    <span style={{ color: 'var(--amber)' }}>
                      {p.stock} / mín. {p.min_stock}
                    </span>
                  </div>
                ))}
                {!d.lowStock.length && <p className="muted">Sin alertas de stock bajo.</p>}
              </div>
            </div>
          )}
          {tab === 'shifts' && (
            <div className="stack" style={{ marginTop: 20 }}>
              <label>
                Empleado
                <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                  <option value="">Todos los empleados</option>
                  {d.employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filtrar por turno
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">Todos los turnos</option>
                  {Object.entries(shiftNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {d.shifts
                .filter(
                  (s) =>
                    (!filter || s.type === filter) &&
                    (!employeeFilter || s.user?.id === employeeFilter),
                )
                .map((s) => {
                  const payments = { CASH: 0, MP: 0, CARD: 0 };
                  for (const p of s.operations.flatMap((o) => o.payments))
                    payments[p.method] += p.amount;
                  return (
                    <details className="card" key={s.id}>
                      <summary>
                        <strong>
                          {shiftNames[s.type]} · {s.user?.name}
                        </strong>
                        <br />
                        <small>
                          {s.businessDate} ·{' '}
                          {s.closedAt
                            ? s.difference === 0
                              ? 'Caja correcta'
                              : `Diferencia ${money(s.difference || 0)}`
                            : 'En curso'}{' '}
                          ·{' '}
                          {money(
                            s.operations
                              .filter((o) => o.type !== 'OWNER')
                              .reduce((sum, o) => sum + o.total, 0),
                          )}
                        </small>
                      </summary>
                      <div className="stack" style={{ marginTop: 16 }}>
                        <small>
                          {dateTime(s.openedAt)} → {s.closedAt ? dateTime(s.closedAt) : 'Abierto'}
                        </small>
                        <div className="row">
                          {Object.entries(payments).map(([method, value]) => (
                            <span className="pill" key={method}>
                              {paymentNames[method as keyof typeof payments]} {money(value)}
                            </span>
                          ))}
                        </div>
                        {s.closedAt && (
                          <p>
                            Caja inicial {money(s.openingCash)} · Esperado al cierre{' '}
                            {money(s.expectedCash || 0)} · Contado {money(s.countedCash || 0)} ·
                            Diferencia {money(s.difference || 0)}
                          </p>
                        )}
                        {s.operations.map((o) => (
                          <div className="cart-line" key={o.id}>
                            <div className="row between">
                              <strong>
                                {money(o.total)} ·{' '}
                                {o.type === 'EMPLOYEE'
                                  ? 'Consumo empleado'
                                  : o.type === 'OWNER'
                                    ? 'Retiro del dueño'
                                    : 'Venta'}
                              </strong>
                              <button
                                className="danger"
                                disabled={busy}
                                onClick={async () => {
                                  const reason = window.prompt('Motivo de la anulación:');
                                  if (!reason) return;
                                  setBusy(true);
                                  try {
                                    await request(`sales/${o.id}/void`, 'POST', { reason });
                                    await remote.refresh();
                                  } catch (e) {
                                    setError(errorMessage(e));
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                Anular
                              </button>
                            </div>
                            <small>{dateTime(o.createdAt)}</small>
                            <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              {!d.shifts.length && <p className="empty card">No hay turnos en este período.</p>}
            </div>
          )}
          {tab === 'employees' && (
            <div className="card table-wrap" style={{ marginTop: 20 }}>
              <h2>Por empleado</h2>
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Ventas</th>
                    <th>Total cobrado</th>
                    <th>Ticket promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {d.employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          onClick={() => {
                            setEmployeeFilter(e.id);
                            setTab('shifts');
                          }}
                        >
                          {e.name}
                        </button>
                      </td>
                      <td>{e.count}</td>
                      <td>{money(e.total)}</td>
                      <td>{money(e.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
