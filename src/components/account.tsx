'use client';
import { request, errorMessage } from '@/lib/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearOfflineSession } from '@/modules/offline/catalog';
export function Account({ required = false }: { required?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="card stack" style={{ maxWidth: 520 }}>
      <p className="overline">Tu cuenta</p>
      <h1>{required ? 'Elegí tu contraseña.' : 'Cuidá tu acceso.'}</h1>
      <p className="muted">
        {required
          ? 'Antes de empezar, reemplazá la contraseña temporal.'
          : 'Podés cambiar tu contraseña o salir de este dispositivo.'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          if (d.get('password') !== d.get('repeat')) {
            setError('Las contraseñas nuevas no coinciden.');
            return;
          }
          setBusy(true);
          try {
            await request('auth/password', 'POST', {
              current: d.get('current'),
              password: d.get('password'),
            });
            await clearOfflineSession().catch(() => {});
            router.replace('/login');
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Contraseña actual
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label>
          Contraseña nueva
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
          Repetir contraseña nueva
          <input name="repeat" type="password" autoComplete="new-password" required />
        </label>
        <button className="primary" disabled={busy}>
          Cambiar contraseña y volver a ingresar
        </button>
      </form>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await request('auth/logout', 'POST');
            await clearOfflineSession().catch(() => {});
            router.replace('/login');
            router.refresh();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
