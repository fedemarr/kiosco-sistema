'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Actor } from '@/modules/auth/permissions';
import { can } from '@/modules/auth/permissions';
import { pendingSales, syncSales, type Pending } from '@/modules/offline/queue';
import { money, dateTime } from '@/lib/format';
export function OfflineStatus({ user }: { user: Actor }) {
  const [online, setOnline] = useState(true);
  const [sales, setSales] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    setOnline(navigator.onLine);
    void pendingSales(user.id, can(user, 'owner'))
      .then(setSales)
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    const onOnline = () => {
      refresh();
      void syncSales(user.id);
    };
    const timer = setTimeout(onOnline, 0);
    const interval = setInterval(() => {
      if (navigator.onLine)
        void pendingSales(user.id)
          .then((p) => {
            if (p.length) void syncSales(user.id);
          })
          .catch(() => {});
    }, 5000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refresh);
    window.addEventListener('queue-change', refresh);
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('queue-change', refresh);
    };
  }, [refresh, user.id]);
  if (online && !sales.length) return null;
  return (
    <div className="note stack" style={{ marginBottom: 20 }}>
      <strong>
        {online
          ? `${sales.length} cobro(s) pendiente(s) en este dispositivo`
          : 'Sin conexión · Las ventas pendientes todavía no están confirmadas'}
      </strong>
      {sales.length > 0 && (
        <details>
          <summary>Ver cobros pendientes</summary>
          {sales.map((s) => (
            <p key={s.key}>
              <small>
                {dateTime(s.createdAt)} · {s.key.slice(0, 8)}
              </small>
              <br />
              {money(s.payload.payments.reduce((sum, p) => sum + p.amount, 0))} ·{' '}
              {s.status === 'REVIEW'
                ? `Revisar con el dueño: ${s.error}`
                : 'Pendiente de sincronización'}
            </p>
          ))}
          <small>
            La revisión muestra los cobros guardados en este navegador. Conservá este dispositivo
            hasta resolverlos.
          </small>
        </details>
      )}
      <button
        disabled={!online || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await syncSales(user.id);
          } finally {
            setBusy(false);
            refresh();
          }
        }}
      >
        {busy ? 'Sincronizando…' : 'Sincronizar mis cobros'}
      </button>
    </div>
  );
}
