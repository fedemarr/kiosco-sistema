'use client';
import { useState } from 'react';
import {
  Download,
  TrendingUp,
  Banknote,
  Package,
  ChartNoAxesCombined,
  CalendarDays,
  ClipboardCheck,
  Users,
  Bell,
  ChevronLeft,
  ChevronRight,
  Sun,
  Sunset,
  Moon,
} from 'lucide-react';
import { useRemote } from '@/hooks/use-remote';
import { businessDate, money } from '@/lib/format';
import { shiftNames, type Shift } from '@/lib/types';
import { ReportShifts } from './report-shifts';
import { ReportStock, ReportAlerts } from './report-tools';
export type Report = {
  total: number;
  cost: number | null;
  profit: number | null;
  unknownCostCount: number;
  employeeTotal: number;
  saleCount: number;
  payments: { CASH: number; CARD: number; MP: number; UNALLOCATED: number };
  top: { name: string; quantity: number; total: number }[];
  days: { day: string; total: number; profit: number | null }[];
  employees: { id: string; name: string; count: number; total: number; average: number }[];
  shifts: Shift[];
  lowStock: { id: string; name: string; stock: number; min_stock: number }[];
  lowStockCount: number;
  pendingRequests: number;
  truncated: boolean;
};
const tabs = [
  { id: 'shifts', name: 'Turnos', icon: ClipboardCheck },
  { id: 'today', name: 'Hoy', icon: CalendarDays },
  { id: 'week', name: 'Semana', icon: ChartNoAxesCombined },
  { id: 'employees', name: 'Empleados', icon: Users },
  { id: 'stock', name: 'Stock', icon: Package },
  { id: 'alerts', name: 'Alertas', icon: Bell },
];
const shiftIcons = { MORNING: Sun, AFTERNOON: Sunset, NIGHT: Moon };
export const payColors = {
  CASH: '#22c55e',
  MP: '#06b6d4',
  CARD: '#60a5fa',
  UNALLOCATED: '#fbbf24',
};
export const payLabels = {
  CASH: 'Efectivo',
  MP: 'Mercado Pago',
  CARD: 'Tarjeta',
  UNALLOCATED: 'Mixto histórico sin desglose',
};
function moveDate(day: string, amount: number) {
  return new Date(new Date(day + 'T12:00:00-03:00').getTime() + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function ReportScreen() {
  const [date, setDate] = useState(businessDate());
  const [tab, setTab] = useState('shifts');
  const [shiftFilter, setShiftFilter] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const rangeEnabled = tab === 'shifts' || tab === 'employees';
  const from = rangeEnabled && rangeStart ? rangeStart : tab === 'week' ? moveDate(date, -6) : date;
  const remote = useRemote<Report>(`reports?from=${from}&to=${date}`);
  const d = remote.data;
  const shifts = d?.shifts.filter((s) => !shiftFilter || s.type === shiftFilter) || [];
  const operations = shifts.flatMap((s) => s.operations).filter((o) => o.type !== 'OWNER');
  const shiftPayments = { CASH: 0, MP: 0, CARD: 0 };
  for (const p of operations.flatMap((o) => o.payments)) shiftPayments[p.method] += p.amount;
  const dashboard = tab === 'today' || tab === 'week';
  const unallocated =
    tab === 'shifts'
      ? operations.reduce((sum, o) => sum + (o.unallocatedPayment || 0), 0)
      : d?.payments.UNALLOCATED || 0;
  return (
    <div className="owner-panel">
      <header className="owner-header">
        <h1>Panel del dueño</h1>
        <nav className="owner-tabs" aria-label="Panel del dueño">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? 'page' : undefined}
              className={tab === t.id ? 'selected' : ''}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={17} />
              {t.name}
            </button>
          ))}
        </nav>
      </header>
      <div className="owner-content">
        {dashboard && !!d?.unknownCostCount && (
          <p className="note">
            {d.unknownCostCount} ventas históricas no incluyen costos de esa fecha. Costo y ganancia
            se muestran sin datos para ese período.
          </p>
        )}
        {!!unallocated && (
          <p className="note">
            Pagos mixtos históricos sin desglose: {money(unallocated)}. El total vendido se
            conserva; esos importes no se asignan a efectivo ni Mercado Pago.
          </p>
        )}
        {remote.error && (
          <p className="error" role="alert">
            {remote.error}
          </p>
        )}
        {remote.loading && <p>Cargando reportes…</p>}
        {rangeEnabled && rangeStart && (
          <p className="muted">
            Período: {from.split('-').reverse().join('/')} al {date.split('-').reverse().join('/')}
          </p>
        )}
        {d?.truncated && (
          <p className="note">
            El rango alcanzó 1.000 turnos. Elegí un período más corto para ver totales completos.
          </p>
        )}
        {d && (
          <>
            {tab !== 'alerts' &&
              tab !== 'stock' &&
              (tab === 'shifts' ? (
                <div className="shift-day-picker card">
                  <div className="date-navigation">
                    <button aria-label="Día anterior" onClick={() => setDate(moveDate(date, -1))}>
                      <ChevronLeft />
                    </button>
                    <label>
                      <strong>
                        {date === businessDate()
                          ? 'Hoy'
                          : new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
                              weekday: 'long',
                            })}
                      </strong>
                      <input
                        aria-label="Fecha de los turnos"
                        type="date"
                        value={date}
                        max={businessDate()}
                        onChange={(e) => {
                          if (e.target.value) setDate(e.target.value);
                        }}
                      />
                    </label>
                    <button
                      aria-label="Día siguiente"
                      disabled={date >= businessDate()}
                      onClick={() => setDate(moveDate(date, 1))}
                    >
                      <ChevronRight />
                    </button>
                  </div>
                  <div className="shift-filter">
                    <button
                      className={!shiftFilter ? 'selected' : ''}
                      onClick={() => setShiftFilter('')}
                    >
                      <CalendarDays size={18} />
                      Todos
                    </button>
                    {Object.entries(shiftNames).map(([key, name]) => {
                      const Icon = shiftIcons[key as keyof typeof shiftIcons];
                      return (
                        <button
                          key={key}
                          className={shiftFilter === key ? 'selected' : ''}
                          onClick={() => setShiftFilter(key)}
                        >
                          <Icon size={18} />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <input
                  className="report-date"
                  aria-label="Fecha del reporte"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) setDate(e.target.value);
                  }}
                />
              ))}
            {tab === 'week' && (
              <p className="muted">
                Del {new Date(from + 'T12:00:00').toLocaleDateString('es-AR')} al{' '}
                {new Date(date + 'T12:00:00').toLocaleDateString('es-AR')}
              </p>
            )}
            {dashboard && (
              <>
                <div className="report-stats">
                  {[
                    { label: 'Total vendido', value: d.total, icon: Banknote, tone: 'violet' },
                    { label: 'Ganancia neta', value: d.profit, icon: TrendingUp, tone: 'green' },
                    { label: 'Costo repuesto', value: d.cost, icon: Package, tone: 'amber' },
                    {
                      label: 'Ventas',
                      value: d.saleCount,
                      icon: ChartNoAxesCombined,
                      tone: 'purple',
                    },
                  ].map((s, i) => (
                    <div className={`report-stat ${s.tone}`} key={s.label}>
                      <span>
                        <s.icon size={18} />
                        {s.label}
                      </span>
                      <strong>
                        {s.value === null ? 'Sin datos' : i === 3 ? s.value : money(s.value)}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="report-columns">
                  <section className="report-card">
                    <h2>Por medio de pago</h2>
                    <PaymentDonut payments={d.payments} />
                  </section>
                  <section className="report-card">
                    <h2>Por empleado</h2>
                    {d.employees.map((e) => (
                      <div className="employee-bar" key={e.id}>
                        <div className="row between">
                          <span>{e.name}</span>
                          <strong>{money(e.total)}</strong>
                        </div>
                        <div className="mini-chart">
                          <span style={{ width: `${d.total ? (e.total / d.total) * 100 : 0}%` }} />
                        </div>
                        <small>
                          {e.count} ventas · {d.total ? Math.round((e.total / d.total) * 100) : 0}%
                        </small>
                      </div>
                    ))}
                    {!d.employees.length && <p className="empty">Sin ventas en este período.</p>}
                  </section>
                  <section className="report-card">
                    <h2>Top productos</h2>
                    {d.top.map((p, i) => (
                      <div className="top-product" key={p.name}>
                        <small>{i + 1}</small>
                        <span>
                          {p.name}
                          <small>{p.quantity} unidades</small>
                        </span>
                        <strong>{money(p.total)}</strong>
                      </div>
                    ))}
                    {!d.top.length && (
                      <p className="empty">Todavía no hay ventas en este período.</p>
                    )}
                  </section>
                </div>
                {tab === 'week' && (
                  <section className="report-card week-chart">
                    <h2>Ventas de la semana</h2>
                    <p className="muted">
                      Proyección a 30 días: {money(Math.round((d.total / 7) * 30))}. Estimación
                      según el promedio de estos siete días.
                    </p>
                    <div className="week-bars">
                      {Array.from({ length: 7 }, (_, i) => {
                        const day = moveDate(from, i);
                        const value = d.days.find((v) => v.day === day);
                        const max = Math.max(1, ...d.days.map((v) => v.total));
                        return (
                          <div key={day}>
                            <small>{money(value?.total || 0)}</small>
                            <div className="week-track">
                              <span style={{ height: `${((value?.total || 0) / max) * 100}%` }} />
                            </div>
                            <small>
                              {new Date(day + 'T12:00:00').toLocaleDateString('es-AR', {
                                weekday: 'short',
                                day: 'numeric',
                              })}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
                <small className="report-explanation">
                  Incluye consumo de empleados: {money(d.employeeTotal)}. Ganancia según costos
                  registrados; el costo repuesto corresponde al costo de lo vendido. Retiros del
                  dueño separados.
                </small>
              </>
            )}
            {tab === 'shifts' && (
              <>
                <div className="shift-stats">
                  <div className="report-stat violet">
                    <span>Total del día</span>
                    <strong>{money(operations.reduce((sum, o) => sum + o.total, 0))}</strong>
                  </div>
                  {Object.entries(shiftPayments).map(([key, value]) => (
                    <div className="report-stat" key={key}>
                      <span>{payLabels[key as keyof typeof payLabels]}</span>
                      <strong style={{ color: payColors[key as keyof typeof payColors] }}>
                        {money(value)}
                      </strong>
                    </div>
                  ))}
                  <div className="report-stat">
                    <span>Ventas</span>
                    <strong>{operations.filter((o) => o.type === 'SALE').length}</strong>
                  </div>
                </div>
                <ReportShifts shifts={shifts} refresh={remote.refresh} />
                <EmployeeTable shifts={shifts} />
              </>
            )}
            {tab === 'employees' && <EmployeeTable shifts={d.shifts} />}
            {tab === 'stock' && (
              <ReportStock products={d.lowStock} count={d.lowStockCount} refresh={remote.refresh} />
            )}
            {tab === 'alerts' && <ReportAlerts />}
            {rangeEnabled && (
              <details className="report-card" style={{ marginTop: 20 }}>
                <summary>Elegir rango de fechas</summary>
                <div className="fields" style={{ marginTop: 16 }}>
                  <label>
                    Desde
                    <input
                      type="date"
                      value={rangeStart || date}
                      max={date}
                      onChange={(e) => setRangeStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Hasta
                    <input
                      type="date"
                      value={date}
                      min={rangeStart || undefined}
                      onChange={(e) => {
                        if (e.target.value) setDate(e.target.value);
                      }}
                    />
                  </label>
                </div>
                <button style={{ marginTop: 12 }} onClick={() => setRangeStart('')}>
                  Ver un solo día
                </button>
                <small> Hasta 93 días por consulta.</small>
              </details>
            )}
            {tab !== 'alerts' && tab !== 'stock' && (
              <a
                className="report-export row"
                href={`/api/exports?kind=reports&from=${from}&to=${date}`}
                download
              >
                <Download size={16} />
                Exportar Excel
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function PaymentDonut({ payments }: { payments: Report['payments'] }) {
  const entries = Object.entries(payments) as [keyof typeof payColors, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let offset = 0;
  return (
    <>
      <svg
        className="payment-donut"
        viewBox="0 0 200 200"
        role="img"
        aria-label={total ? 'Distribución por medio de pago' : 'Sin pagos en este período'}
      >
        <circle cx="100" cy="100" r="74" fill="none" stroke="var(--line)" strokeWidth="30" />
        {entries.map(([key, v]) => {
          const length = total ? (v / total) * 464.956 : 0;
          const start = offset;
          offset += length;
          return (
            <circle
              key={key}
              cx="100"
              cy="100"
              r="74"
              fill="none"
              stroke={payColors[key]}
              strokeWidth="30"
              strokeDasharray={`${length} ${464.956 - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 100 100)"
            />
          );
        })}
      </svg>
      <div className="payment-legend">
        {entries
          .filter(([, v]) => v > 0 || !total)
          .map(([key, value]) => (
            <div className="row between" key={key}>
              <span>
                <i style={{ background: payColors[key] }} />
                {payLabels[key]}
              </span>
              <strong>{money(value)}</strong>
            </div>
          ))}
      </div>
    </>
  );
}
function EmployeeTable({ shifts }: { shifts: Shift[] }) {
  const employees = new Map<
    string,
    {
      name: string;
      count: number;
      total: number;
      saleTotal: number;
      payments: { CASH: number; MP: number; CARD: number };
      shifts: number;
    }
  >();
  for (const s of shifts) {
    const id = s.user?.id || '';
    const e = employees.get(id) || {
      name: s.user?.name || '',
      count: 0,
      total: 0,
      saleTotal: 0,
      payments: { CASH: 0, MP: 0, CARD: 0 },
      shifts: 0,
    };
    e.shifts++;
    for (const o of s.operations) {
      if (o.type === 'OWNER') continue;
      e.total += o.total;
      if (o.type === 'SALE') {
        e.count++;
        e.saleTotal += o.total;
      }
      for (const p of o.payments) e.payments[p.method] += p.amount;
    }
    employees.set(id, e);
  }
  return (
    <section className="report-card table-wrap employee-table">
      <h2>Por empleado</h2>
      <table>
        <thead>
          <tr>
            <th>EMPLEADO</th>
            <th>VENTAS</th>
            <th>EFECTIVO</th>
            <th>MP</th>
            <th>TARJETA</th>
            <th>TOTAL</th>
            <th>TICKET PROM.</th>
          </tr>
        </thead>
        <tbody>
          {[...employees].map(([id, e]) => (
            <tr key={id}>
              <td>
                <strong>{e.name}</strong>
                <small>{e.shifts} turnos</small>
              </td>
              <td>{e.count}</td>
              {Object.entries(e.payments).map(([k, v]) => (
                <td style={{ color: payColors[k as keyof typeof payColors] }} key={k}>
                  {money(v)}
                </td>
              ))}
              <td>
                <strong>{money(e.total)}</strong>
              </td>
              <td>{money(e.count ? Math.round(e.saleTotal / e.count) : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!employees.size && <p className="empty">No hay movimientos en este período.</p>}
    </section>
  );
}
