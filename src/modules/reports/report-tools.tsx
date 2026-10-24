'use client';
import { useRef, useState } from 'react';
import { TriangleAlert, Plus } from 'lucide-react';
import { request, errorMessage } from '@/lib/client';
import { useRemote } from '@/hooks/use-remote';
import { dateTime, money } from '@/lib/format';
import { OfflineReview } from '@/modules/offline/review';
import type { Report } from './report-screen';
type LowProduct = Report['lowStock'][number];
export function ReportStock({
  products,
  count,
  refresh,
}: {
  products: LowProduct[];
  count: number;
  refresh: () => Promise<void>;
}) {
  const [product, setProduct] = useState<LowProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <section className="low-stock-panel">
        <h2>
          <TriangleAlert size={22} />
          {count} productos con stock bajo
        </h2>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        <div className="low-stock-grid">
          {products.map((p) => (
            <div className="low-stock-row" key={p.id}>
              <span>
                <strong>{p.name}</strong>
                <small>
                  Stock: {p.stock} / mín: {p.min_stock}
                </small>
              </span>
              <button
                onClick={() => {
                  setProduct(p);
                  setError('');
                  dialog.current?.showModal();
                }}
              >
                <Plus size={16} />
                Ingresar
              </button>
            </div>
          ))}
        </div>
        {!products.length && <p>Sin alertas de stock bajo.</p>}
        {count > products.length && (
          <p>
            Mostrando los {products.length} con menor stock. Ingresá unidades para continuar con los
            siguientes.
          </p>
        )}
      </section>
      <dialog ref={dialog} onClose={() => setProduct(null)}>
        <div className="row between">
          <h2>Ingresar stock</h2>
          <button aria-label="Cerrar ingreso de stock" onClick={() => dialog.current?.close()}>
            Cerrar
          </button>
        </div>
        {product && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await request(`products/${product.id}/movements`, 'POST', {
                  type: 'RECEIPT',
                  quantity: Number(data.get('quantity')),
                  note: String(data.get('note') || 'Reposición desde panel del dueño'),
                });
                setMessage(`Ingreso registrado: ${product.name}.`);
                dialog.current?.close();
                await refresh();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <strong>{product.name}</strong>
            <p className="muted">Stock actual: {product.stock}</p>
            <label>
              Cantidad a sumar
              <input name="quantity" type="number" min="1" step="1" required autoFocus />
            </label>
            <label>
              Motivo / remito
              <input name="note" maxLength={500} />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Registrar ingreso'}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  detail: Record<string, unknown>;
  user: { name: string };
};
const actions: Record<string, string> = {
  SALE: 'Venta',
  EMPLOYEE: 'Consumo empleado',
  OWNER: 'Retiro del dueño',
  SHIFT_OPENED: 'Abrir turno',
  SHIFT_CLOSED: 'Cerrar turno',
  STOCK_ADJUSTED: 'Ingreso / ajuste de stock',
  OPERATION_VOIDED: 'Anulación',
  PRODUCT_CREATED: 'Producto creado',
  PRODUCT_UPDATED: 'Producto actualizado',
  USER_CREATED: 'Usuario creado',
  USER_UPDATED: 'Usuario actualizado',
  LOGIN: 'Inicio de sesión',
  PASSWORD_CHANGED: 'Cambio de contraseña',
  OFFLINE_REVIEWED: 'Cobro pendiente revisado',
  LEGACY_IMPORTED: 'Migración de datos',
};
function describe(entry: AuditEntry) {
  const d = entry.detail;
  const parts: string[] = [];
  if (typeof d.total === 'number') parts.push(`Total: ${money(d.total)}`);
  if (typeof d.openingCash === 'number') parts.push(`Caja inicial: ${money(d.openingCash)}`);
  if (typeof d.expectedCash === 'number') parts.push(`Esperado: ${money(d.expectedCash)}`);
  if (typeof d.countedCash === 'number') parts.push(`Contado: ${money(d.countedCash)}`);
  if (typeof d.quantity === 'number') parts.push(`Unidades: ${d.quantity}`);
  if (typeof d.note === 'string') parts.push(d.note);
  if (typeof d.reason === 'string') parts.push(d.reason);
  if (typeof d.name === 'string') parts.push(d.name);
  if (typeof d.products === 'number') parts.push(`${d.products} productos`);
  if (typeof d.sales === 'number') parts.push(`${d.sales} ventas históricas`);
  if (typeof d.totalCents === 'number') parts.push(`Total histórico: ${money(d.totalCents)}`);
  return parts.join(' · ') || 'Movimiento registrado en el sistema.';
}
export function ReportAlerts() {
  const [filter, setFilter] = useState({ date: '', from: '', to: '', user: '', action: '' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const users = useRemote<{ id: string; name: string }[]>('users');
  const remote = useRemote<AuditEntry[]>(`audit?page=${page}${query}`);
  function search() {
    const q = new URLSearchParams();
    if (filter.user) q.set('user', filter.user);
    if (filter.action) q.set('action', filter.action);
    if (filter.date) {
      q.set('from', new Date(`${filter.date}T${filter.from || '00:00'}:00-03:00`).toISOString());
      q.set('to', new Date(`${filter.date}T${filter.to || '23:59'}:59.999-03:00`).toISOString());
    }
    setPage(1);
    setQuery('&' + q.toString());
  }
  return (
    <div className="stack">
      <section className="audit-filters report-card">
        <h2>FILTRAR MOVIMIENTOS</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <div className="fields">
            <label>
              Fecha
              <input
                type="date"
                value={filter.date}
                onChange={(e) => setFilter({ ...filter, date: e.target.value })}
                required={!!(filter.from || filter.to)}
              />
            </label>
            <label>
              Hora desde
              <input
                type="time"
                value={filter.from}
                onChange={(e) => setFilter({ ...filter, from: e.target.value })}
              />
            </label>
            <label>
              Hora hasta
              <input
                type="time"
                value={filter.to}
                onChange={(e) => setFilter({ ...filter, to: e.target.value })}
              />
            </label>
          </div>
          <div className="fields">
            <label>
              Empleado
              <select
                aria-label="Empleado"
                value={filter.user}
                onChange={(e) => setFilter({ ...filter, user: e.target.value })}
              >
                <option value="">Todos</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo de acción
              <select
                aria-label="Tipo de acción"
                value={filter.action}
                onChange={(e) => setFilter({ ...filter, action: e.target.value })}
              >
                <option value="">Todas</option>
                {Object.entries(actions).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button className="primary">Buscar</button>
            <button
              type="button"
              onClick={() => {
                setFilter({ date: '', from: '', to: '', user: '', action: '' });
                setQuery('');
                setPage(1);
              }}
            >
              Limpiar
            </button>
            <small>Mostrando hasta 50 movimientos · página {page}</small>
          </div>
        </form>
      </section>
      <OfflineReview />
      {(remote.error || users.error) && (
        <p className="error" role="alert">
          {remote.error || users.error}
        </p>
      )}
      {remote.loading && <p>Cargando movimientos…</p>}
      {remote.data?.map((e) => (
        <article
          className={`audit-entry ${e.action === 'SALE' ? 'audit-sale' : e.action === 'STOCK_ADJUSTED' ? 'audit-stock' : ''}`}
          key={e.id}
        >
          <i />
          <div>
            <div className="row">
              <strong>{e.user.name}</strong>
              <span className="audit-action">{actions[e.action] || e.action}</span>
            </div>
            <p>{describe(e)}</p>
          </div>
          <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
        </article>
      ))}
      {remote.data?.length === 0 && (
        <p className="empty report-card">No hay movimientos con estos filtros.</p>
      )}
      <div className="row">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <button
          disabled={!remote.data || remote.data.length < 50}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
