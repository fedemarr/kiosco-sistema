'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readSnapshot, type Snapshot } from '@/modules/offline/catalog';
import { AppShell } from './app-shell';
import { Pos } from '@/modules/sales/pos';
import { syncSales } from '@/modules/offline/queue';
export function OfflineWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void readSnapshot()
      .then(setSnapshot)
      .catch(() => {})
      .finally(() => setReady(true));
    const online = async () => {
      const current = await readSnapshot().catch(() => null);
      if (current) await syncSales(current.user.id);
      // Recarga completa para obtener un layout con sesión y permisos verificados en el servidor.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/caja');
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  if (!ready)
    return (
      <main className="login">
        <p>Abriendo tu Caja sin conexión…</p>
      </main>
    );
  if (!snapshot)
    return (
      <main className="login">
        <div className="card stack">
          <h1>Conectate para empezar.</h1>
          <p>Primero ingresá y abrí tu turno con internet para preparar este dispositivo.</p>
          <Link className="navlink" href="/login">
            Volver a ingresar →
          </Link>
        </div>
      </main>
    );
  return (
    <AppShell user={snapshot.user}>
      <Pos />
    </AppShell>
  );
}
