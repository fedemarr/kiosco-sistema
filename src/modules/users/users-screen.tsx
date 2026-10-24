'use client';
import { useState } from 'react';
import { useRemote } from '@/hooks/use-remote';
import { request, errorMessage } from '@/lib/client';
type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  stockEnabled: boolean;
  deletedAt: string | null;
};
type StockRequest = { id: string; user: { name: string } };
export function UsersScreen() {
  const users = useRemote<User[]>('users');
  const requests = useRemote<StockRequest[]>('stock-requests');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  async function action(path: string, method: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(path, method, body);
      setMessage('Cambios guardados.');
      await Promise.all([users.refresh(), requests.refresh()]);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head row between">
        <div>
          <p className="overline">Equipo</p>
          <h1>Las personas detrás del kiosco.</h1>
          <p className="muted">Gestioná sus permisos y acceso al stock.</p>
        </div>
        <button className="primary" onClick={() => setAdding(!adding)}>
          + Agregar usuario
        </button>
      </header>
      {(error || users.error) && (
        <p className="error" role="alert">
          {error || users.error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {adding && (
        <form
          className="card stack toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const ok = await action('users', 'POST', {
              name: d.get('name'),
              username: d.get('username'),
              password: d.get('password'),
              role: d.get('role'),
              stockEnabled: d.get('stockEnabled') === 'on',
            });
            if (ok) setAdding(false);
          }}
        >
          <h2>Nuevo integrante</h2>
          <div className="fields">
            <label>
              Nombre
              <input name="name" required minLength={2} />
            </label>
            <label>
              Usuario
              <input name="username" autoCapitalize="none" required />
            </label>
            <label>
              Contraseña temporal
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Rol
              <select name="role">
                <option value="SELLER">Vendedor</option>
                <option value="ADMIN">Administrador</option>
                <option value="OWNER">Dueño</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" name="stockEnabled" />
            Habilitar stock
          </label>
          <small>Deberá cambiar su contraseña en el primer ingreso.</small>
          <button className="primary" disabled={busy}>
            Crear usuario
          </button>
        </form>
      )}
      {!!requests.data?.length && (
        <div className="card stack toolbar">
          <h2>Solicitudes de acceso al stock</h2>
          {requests.data.map((r) => (
            <div className="row between" key={r.id}>
              <strong>{r.user.name}</strong>
              <div className="row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void action(`stock-requests/${r.id}`, 'PATCH', { approve: true })}
                >
                  Aprobar
                </button>
                <button
                  disabled={busy}
                  onClick={() => void action(`stock-requests/${r.id}`, 'PATCH', { approve: false })}
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="stack">
        {users.data?.map((u) => (
          <div className="card row between" key={u.id}>
            <div>
              <strong>{u.name}</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                @{u.username} ·{' '}
                {u.role === 'SELLER' ? 'Vendedor' : u.role === 'OWNER' ? 'Dueño' : 'Administrador'}{' '}
                · {u.deletedAt ? 'Inactivo' : 'Activo'}
              </p>
            </div>
            <div className="row">
              {u.role === 'SELLER' && !u.deletedAt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(`users/${u.id}`, 'PATCH', { stockEnabled: !u.stockEnabled })
                  }
                >
                  {u.stockEnabled ? 'Quitar acceso al stock' : 'Habilitar stock'}
                </button>
              )}
              <button
                className={u.deletedAt ? '' : 'danger'}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`¿${u.deletedAt ? 'Reactivar' : 'Desactivar'} a ${u.name}?`))
                    void action(`users/${u.id}`, 'PATCH', { active: !!u.deletedAt });
                }}
              >
                {u.deletedAt ? 'Reactivar' : 'Desactivar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
