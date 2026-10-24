'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ShoppingBasket,
  Package,
  Clock3,
  ChartNoAxesCombined,
  Users,
  Settings2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import type { Actor } from '@/modules/auth/permissions';
import { can } from '@/modules/auth/permissions';
import { request, errorMessage } from '@/lib/client';
import { OfflineStatus } from './offline-status';
import { clearOfflineSession } from '@/modules/offline/catalog';
const UserContext = createContext<Actor | null>(null);
export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error('Falta sesión');
  return user;
}
export function AppShell({ user, children }: { user: Actor; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [error, setError] = useState('');
  const links = [
    { href: '/caja', label: 'Caja', icon: ShoppingBasket },
    { href: '/stock', label: 'Stock', icon: Package },
    { href: '/turnos', label: 'Mi turno', icon: Clock3 },
    ...(can(user, 'owner')
      ? [
          { href: '/reportes', label: 'Reportes', icon: ChartNoAxesCombined },
          { href: '/usuarios', label: 'Usuarios', icon: Users },
          { href: '/ajustes', label: 'Ajustes', icon: Settings2 },
        ]
      : []),
  ];
  return (
    <UserContext.Provider value={user}>
      <div className="shell">
        <aside className="sidebar">
          <Link className="brand" href="/caja">
            <span className="brand-mark">K</span>Kiosco POS
          </Link>
          <Link href="/cuenta" className="sidebar-account">
            <span>{user.name}</span>
            <span className="role-badge">
              {user.role === 'OWNER'
                ? 'dueño'
                : user.role === 'ADMIN'
                  ? 'administrador'
                  : 'vendedor'}
            </span>
          </Link>
          <nav aria-label="Navegación principal">
            {links.map((l) => (
              <Link
                className={`navlink ${path === l.href ? 'active' : ''}`}
                href={l.href}
                key={l.href}
              >
                <l.icon size={20} />
                {l.label}
              </Link>
            ))}
          </nav>
          <footer className="stack">
            <small className="row">
              <ShieldCheck size={16} />
              {user.role === 'SELLER' ? 'Vendedor' : 'Administración'}
            </small>
            <strong>{user.name}</strong>
            <button
              className="row"
              onClick={async () => {
                try {
                  await request('auth/logout', 'POST');
                  await clearOfflineSession().catch(() => {});
                  router.replace('/login');
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </footer>
        </aside>
        <main
          className={`main ${path === '/caja' || path === '/offline' ? 'main-pos' : ''} ${path === '/reportes' ? 'main-reports' : ''}`}
        >
          <div className="mobile-user row between">
            <Link href="/caja" className="brand">
              <span className="brand-mark">K</span>Kiosco
            </Link>
            <Link href="/cuenta" className="pill">
              {user.name}
            </Link>
          </div>
          <OfflineStatus user={user} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
    </UserContext.Provider>
  );
}
