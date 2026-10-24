'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { errorMessage, request } from '@/lib/client';
import { clearOfflineSession } from '@/modules/offline/catalog';
export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="login">
      <div className="card stack">
        <div className="brand">
          <span className="brand-mark">k</span>Kiosco<span className="badge">POS</span>
        </div>
        <hr className="separator" />
        <div>
          <p className="overline">Tu espacio de trabajo</p>
          <h1>Buen turno.</h1>
          <p className="muted">Ingresá para empezar a trabajar.</p>
        </div>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const data = new FormData(e.currentTarget);
            try {
              const result = await request<{ mustChangePassword: boolean }>(
                'auth/login',
                'POST',
                Object.fromEntries(data),
              );
              await clearOfflineSession().catch(() => {});
              router.push(result.mustChangePassword ? '/cambiar-clave' : '/caja');
              router.refresh();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Usuario
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              placeholder="Tu usuario"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              placeholder="Tu contraseña"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary row" disabled={busy}>
            <LogIn size={18} />
            {busy ? 'Ingresando…' : 'Ingresar al kiosco'}
          </button>
        </form>
        <small className="row">
          <ShieldCheck size={15} />
          Tu sesión dura 7 días.
        </small>
      </div>
    </div>
  );
}
