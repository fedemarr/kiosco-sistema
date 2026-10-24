'use client';
import { useRef, useState } from 'react';
import {
  Plus,
  Search,
  Package,
  Download,
  Upload,
  Pencil,
  History,
  Trash2,
  Layers,
} from 'lucide-react';
import { useRemote } from '@/hooks/use-remote';
import { request, errorMessage } from '@/lib/client';
import type { Product, ProductList, Category } from '@/lib/types';
import { money, dateTime, toCents } from '@/lib/format';
import { useUser } from '@/components/app-shell';
import { can } from '@/modules/auth/permissions';
type Movement = {
  id: string;
  type: string;
  quantity: number;
  before: number;
  after: number;
  note?: string;
  createdAt: string;
  user: { name: string };
};
type Modal =
  | { kind: 'edit'; product?: Product }
  | { kind: 'move'; product: Product; type: 'RECEIPT' | 'COUNT' }
  | { kind: 'history'; product: Product }
  | { kind: 'merge' };
export function StockScreen() {
  const user = useUser();
  const access = can(user, 'stock');
  const owner = can(user, 'owner');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRemote<ProductList>(
    access ? `products?q=${encodeURIComponent(search)}&page=${page}` : null,
  );
  const categories = useRemote<Category[]>(access ? 'categories' : null);
  function open(value: Modal) {
    setModal(value);
    setTimeout(() => dialog.current?.showModal(), 0);
  }
  function close() {
    dialog.current?.close();
    setModal(null);
  }
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setMessage(success);
      close();
      await list.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!access)
    return (
      <div className="card stack">
        <Package size={32} />
        <h1>Acceso al stock</h1>
        <p className="muted">El dueño puede habilitarte para consultar y administrar productos.</p>
        {message && <p className="success">{message}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void action(
              () => request('stock-requests', 'POST'),
              'Solicitud enviada. El dueño la verá en Usuarios.',
            )
          }
        >
          Solicitar acceso
        </button>
      </div>
    );
  return (
    <>
      <header className="page-head row between">
        <div>
          <p className="overline">Inventario</p>
          <h1>Cada producto, en su lugar.</h1>
          <p className="muted">Los cambios de stock siempre dejan un movimiento.</p>
        </div>
        <button className="primary row" onClick={() => open({ kind: 'edit' })}>
          <Plus size={18} />
          Nuevo producto
        </button>
      </header>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {(error || list.error) && (
        <p className="error" role="alert">
          {error || list.error}
        </p>
      )}
      <div className="row toolbar">
        <div className="search" style={{ flex: 1, minWidth: 180 }}>
          <Search size={20} />
          <input
            aria-label="Buscar en stock"
            value={search}
            placeholder="Nombre o código de barras"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {owner && (
          <>
            <a className="navlink" href="/api/exports?kind=products" download>
              <Download size={18} />
              Excel
            </a>
            <label className="navlink" style={{ cursor: 'pointer' }}>
              <Upload size={18} />
              Importar
              <input
                className="sr-only"
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.set('file', file);
                  setBusy(true);
                  try {
                    const res = await fetch('/api/imports', { method: 'POST', body: form });
                    const result = await res.json();
                    if (!res.ok) throw new Error(result.error.message);
                    setMessage(`Excel importado: ${result.data.count} productos procesados.`);
                    await list.refresh();
                  } catch (err) {
                    setError(errorMessage(err));
                  } finally {
                    setBusy(false);
                    e.target.value = '';
                  }
                }}
              />
            </label>
            <button className="row" onClick={() => open({ kind: 'merge' })}>
              <Layers size={18} />
              Duplicados
            </button>
          </>
        )}
      </div>
      <div className="row between toolbar">
        <small>{list.data?.total || 0} productos activos</small>
        <small>Actualización cada 15 segundos</small>
      </div>
      {list.loading && <p className="muted">Cargando productos…</p>}
      {list.data && !list.data.products.length && (
        <div className="card empty">
          <Package size={36} style={{ margin: '0 auto 16px' }} />
          <h2>Tu catálogo empieza acá.</h2>
          <p>Cargá tu primer producto. Los datos del sistema anterior se importarán después.</p>
        </div>
      )}
      <div className="stack">
        {list.data?.products.map((p) => (
          <article key={p.id} className="card">
            <div className="row between">
              <div>
                <strong>{p.name}</strong>
                <p className="muted" style={{ margin: '4px 0' }}>
                  {p.barcode} · {p.category.name}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: 'var(--accent)', fontSize: 20 }}>{money(p.price)}</strong>
                <br />
                <small>
                  Costo {money(p.cost)} ·{' '}
                  {p.cost
                    ? `${Math.round(((p.price - p.cost) / p.cost) * 100)}% margen s/costo`
                    : 'Sin costo'}
                </small>
              </div>
            </div>
            {p.reviewNote && (
              <p className="note" style={{ marginTop: 12 }}>
                {p.reviewNote} Revisá y guardá el producto para confirmar sus datos.
              </p>
            )}
            <div className="row between" style={{ marginTop: 16 }}>
              <span
                className="pill"
                style={{
                  color: p.trackStock && p.stock <= p.minStock ? 'var(--amber)' : undefined,
                }}
              >
                {p.trackStock ? `${p.stock} en stock · mín. ${p.minStock}` : 'Sin control de stock'}
              </span>
              <div className="row">
                <button
                  disabled={!p.trackStock || busy}
                  onClick={() => open({ kind: 'move', product: p, type: 'RECEIPT' })}
                >
                  + Cargar
                </button>
                <button
                  disabled={!p.trackStock || busy}
                  onClick={() => open({ kind: 'move', product: p, type: 'COUNT' })}
                >
                  Corregir
                </button>
                <button
                  aria-label={`Historial de ${p.name}`}
                  onClick={() => open({ kind: 'history', product: p })}
                >
                  <History size={18} />
                </button>
                <button
                  aria-label={`Editar ${p.name}`}
                  onClick={() => open({ kind: 'edit', product: p })}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="danger"
                  aria-label={`Dar de baja ${p.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`¿Dar de baja ${p.name}? Su historial queda guardado.`))
                      void action(
                        () => request(`products/${p.id}`, 'DELETE'),
                        'Producto dado de baja.',
                      );
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {(list.data?.total || 0) > 60 && (
        <div className="row" style={{ marginTop: 20 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <small>Página {page}</small>
          <button disabled={page * 60 >= (list.data?.total || 0)} onClick={() => setPage(page + 1)}>
            Siguiente
          </button>
        </div>
      )}
      <dialog ref={dialog} onCancel={() => setModal(null)}>
        <div className="row between toolbar">
          <h2 style={{ margin: 0 }}>
            {modal?.kind === 'edit'
              ? modal.product
                ? 'Editar producto'
                : 'Nuevo producto'
              : modal?.kind === 'move'
                ? modal.type === 'RECEIPT'
                  ? 'Cargar mercadería'
                  : 'Corregir por conteo'
                : modal?.kind === 'history'
                  ? 'Historial de stock'
                  : 'Fusionar duplicados'}
          </h2>
          <button onClick={close}>Cerrar</button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {modal?.kind === 'edit' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const payload = {
                name: d.get('name'),
                ...(d.get('barcode') ? { barcode: d.get('barcode') } : {}),
                categoryId: d.get('categoryId'),
                cost: toCents(String(d.get('cost'))),
                price: toCents(String(d.get('price'))),
                minStock: Number(d.get('minStock')),
                trackStock: d.get('trackStock') === 'on',
              };
              void action(
                () =>
                  request(
                    `products${modal.product ? `/${modal.product.id}` : ''}`,
                    modal.product ? 'PATCH' : 'POST',
                    payload,
                  ),
                'Producto guardado. Para cargar unidades usá Cargar.',
              );
            }}
          >
            <label>
              Nombre
              <input name="name" required minLength={2} defaultValue={modal.product?.name} />
            </label>
            <label>
              Código de barras (vacío: código interno)
              <input name="barcode" defaultValue={modal.product?.barcode} />
            </label>
            <label>
              Categoría
              <select name="categoryId" defaultValue={modal.product?.categoryId} required>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="fields">
              <label>
                Costo ($)
                <input
                  name="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={(modal.product?.cost || 0) / 100}
                />
              </label>
              <label>
                Precio de venta ($)
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={modal.product ? modal.product.price / 100 : ''}
                />
              </label>
              <label>
                Stock mínimo
                <input
                  name="minStock"
                  type="number"
                  min="0"
                  required
                  defaultValue={modal.product?.minStock || 0}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="trackStock"
                defaultChecked={modal.product?.trackStock ?? true}
              />
              Controlar stock
            </label>
            <p className="muted">
              El stock se carga con movimientos después de guardar el producto.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar producto'}
            </button>
          </form>
        )}
        {modal?.kind === 'move' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action(
                () =>
                  request(`products/${modal.product.id}/movements`, 'POST', {
                    type: modal.type,
                    quantity: Number(d.get('quantity')),
                    note: d.get('note') || undefined,
                  }),
                'Movimiento registrado en el Kardex.',
              );
            }}
          >
            <strong>{modal.product.name}</strong>
            <p className="muted">Stock actual: {modal.product.stock}</p>
            <label>
              {modal.type === 'RECEIPT' ? 'Cantidad a sumar' : 'Cantidad contada'}
              <input
                name="quantity"
                type="number"
                min={modal.type === 'RECEIPT' ? 1 : 0}
                required
              />
            </label>
            <label>
              Motivo / remito (obligatorio si baja)
              <input name="note" maxLength={500} />
            </label>
            <button className="primary" disabled={busy}>
              Registrar movimiento
            </button>
          </form>
        )}
        {modal?.kind === 'history' && <HistoryView id={modal.product.id} />}{' '}
        {modal?.kind === 'merge' && (
          <MergeView
            busy={busy}
            onMerge={(targetId, sourceId) =>
              void action(
                () => request('products/merge', 'POST', { targetId, sourceId }),
                'Productos fusionados. El stock quedó en el producto elegido.',
              )
            }
          />
        )}
      </dialog>
    </>
  );
}
function HistoryView({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, error } = useRemote<Movement[]>(`products/${id}/movements?page=${page}`);
  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {data?.map((m) => (
        <div className="cart-line" key={m.id}>
          <strong>
            {m.type} · {m.quantity > 0 ? '+' : ''}
            {m.quantity}
          </strong>
          <p>
            {m.before} → {m.after}
          </p>
          <small>
            {m.user.name} · {dateTime(m.createdAt)}
            <br />
            {m.note}
          </small>
        </div>
      ))}
      {!data?.length && <p className="muted">Sin movimientos en esta página.</p>}
      <div className="row">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <button disabled={(data?.length || 0) < 50} onClick={() => setPage(page + 1)}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
function MergeView({
  busy,
  onMerge,
}: {
  busy: boolean;
  onMerge: (targetId: string, sourceId: string) => void;
}) {
  const { data, error } =
    useRemote<{ name: string; ids: string[]; count: number }[]>('products/duplicates');
  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Detectamos nombres iguales. Pegá los IDs para elegir el código que conservarás. La operación
        suma los stocks y da de baja el origen.
      </p>
      {data?.map((d) => (
        <div className="card" key={d.name}>
          <strong>{d.name}</strong>
          {d.ids.map((id) => (
            <small style={{ display: 'block', overflowWrap: 'anywhere' }} key={id}>
              {id}
            </small>
          ))}
        </div>
      ))}
      {data?.length === 0 && <p>No encontramos nombres duplicados.</p>}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          if (window.confirm('¿Fusionar estos productos? Revisá cuál código queda.'))
            onMerge(String(d.get('targetId')), String(d.get('sourceId')));
        }}
      >
        <label>
          ID que conserva el stock y código
          <input name="targetId" required />
        </label>
        <label>
          ID que se da de baja
          <input name="sourceId" required />
        </label>
        <button className="primary" disabled={busy}>
          Fusionar
        </button>
      </form>
    </div>
  );
}
