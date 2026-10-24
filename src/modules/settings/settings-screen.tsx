'use client';
import { useState } from 'react';
import { useRemote } from '@/hooks/use-remote';
import { request, errorMessage } from '@/lib/client';
import { dateTime, money, toCents } from '@/lib/format';
import type { Category, Quick } from '@/lib/types';
type Audit = {
  id: string;
  action: string;
  detail: unknown;
  createdAt: string;
  user: { name: string };
};
export function SettingsScreen() {
  const [tab, setTab] = useState('quick');
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const quick = useRemote<Quick[]>('quick?all=1');
  const categories = useRemote<Category[]>('categories');
  const users = useRemote<{ id: string; name: string }[]>('users');
  const logs = useRemote<Audit[]>(
    tab === 'audit'
      ? `audit?action=${encodeURIComponent(actionFilter)}&user=${userFilter}&page=${page}${from ? `&from=${encodeURIComponent(new Date(from + '-03:00').toISOString())}` : ''}${to ? `&to=${encodeURIComponent(new Date(to + '-03:00').toISOString())}` : ''}`
      : null,
  );
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(path, 'POST', body);
      await quick.refresh();
      await categories.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head">
        <p className="overline">Preferencias</p>
        <h1>Un kiosco a tu manera.</h1>
        <p className="muted">Botones rápidos, categorías y registro de actividad.</p>
      </header>
      <div className="row toolbar">
        {[
          ['quick', 'Botones rápidos'],
          ['categories', 'Categorías'],
          ['audit', 'Auditoría'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'primary' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === 'quick' && (
        <div className="stack">
          {quick.data?.map((q) => (
            <form
              key={`${q.id}-${q.price}-${q.name}`}
              className="card fields"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void save('quick', {
                  id: q.id,
                  name: d.get('name'),
                  emoji: d.get('emoji'),
                  price: toCents(String(d.get('price'))),
                  sortOrder: q.sortOrder,
                });
              }}
            >
              <label>
                Nombre
                <input name="name" defaultValue={q.name} required />
              </label>
              <label>
                Emoji
                <input name="emoji" defaultValue={q.emoji} maxLength={8} />
              </label>
              <label>
                Precio ($)
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={q.price / 100}
                  required
                />
              </label>
              <div className="stack">
                <small>{money(q.price)}</small>
                <button disabled={busy}>Guardar</button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void save('quick', {
                      id: q.id,
                      name: q.name,
                      emoji: q.emoji,
                      price: q.price,
                      sortOrder: q.sortOrder,
                      active: !q.active,
                    })
                  }
                >
                  {q.active ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </form>
          ))}
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              void save('quick', {
                name: d.get('name'),
                emoji: d.get('emoji') || '⚡',
                price: toCents(String(d.get('price'))),
                sortOrder: quick.data?.length || 0,
              }).then(() => form.reset());
            }}
          >
            <h2>Agregar botón rápido</h2>
            <div className="fields">
              <label>
                Nombre
                <input name="name" required />
              </label>
              <label>
                Emoji
                <input name="emoji" maxLength={8} />
              </label>
              <label>
                Precio ($)
                <input name="price" type="number" min="0.01" step="0.01" required />
              </label>
            </div>
            <button className="primary" disabled={busy}>
              Crear botón
            </button>
          </form>
        </div>
      )}
      {tab === 'categories' && (
        <div className="card stack">
          <h2>Categorías del catálogo</h2>
          <div className="row">
            {categories.data?.map((c) => (
              <span key={c.id} className="pill">
                {c.name}
              </span>
            ))}
          </div>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              void save('categories', { name: d.get('name') }).then(() => form.reset());
            }}
          >
            <label>
              Nueva categoría
              <input name="name" required minLength={2} />
            </label>
            <button className="primary" disabled={busy}>
              Agregar categoría
            </button>
          </form>
        </div>
      )}
      {tab === 'audit' && (
        <div className="stack">
          <div className="fields">
            <label>
              Tipo de acción
              <input
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="SALE, STOCK, USER…"
              />
            </label>
            <label>
              Empleado
              <select
                value={userFilter}
                onChange={(e) => {
                  setUserFilter(e.target.value);
                  setPage(1);
                }}
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
              Desde (hora argentina)
              <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Hasta (hora argentina)
              <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {logs.error && <p className="error">{logs.error}</p>}
          {logs.data?.map((l) => (
            <div className="card" key={l.id}>
              <div className="row between">
                <strong>{l.action}</strong>
                <small>{dateTime(l.createdAt)}</small>
              </div>
              <small>{l.user.name}</small>
              <details>
                <summary>Ver detalle</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>
                  {JSON.stringify(l.detail, null, 2)}
                </pre>
              </details>
            </div>
          ))}
          <div className="row">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <small>Página {page}</small>
            <button disabled={(logs.data?.length || 0) < 50} onClick={() => setPage(page + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </>
  );
}
