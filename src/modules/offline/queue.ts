import { openDB } from 'idb';
import { request, ApiError } from '@/lib/client';
import type { CheckoutInput } from '@/modules/sales/schema';
export type Pending = {
  key: string;
  userId: string;
  payload: CheckoutInput;
  createdAt: string;
  error?: string;
  status: 'PENDING' | 'REVIEW';
};
export async function database() {
  return openDB('kiosco-pos-v1', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
    },
  });
}
export async function enqueue(userId: string, payload: CheckoutInput) {
  const db = await database();
  await db.put('sales', {
    key: payload.idempotencyKey,
    userId,
    payload,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  } satisfies Pending);
  window.dispatchEvent(new Event('queue-change'));
}
export async function pendingSales(userId: string, owner = false): Promise<Pending[]> {
  return ((await (await database()).getAll('sales')) as Pending[]).filter(
    (p) => owner || p.userId === userId,
  );
}
const syncing = new Map<string, Promise<void>>();
export async function syncSales(userId: string) {
  const existing = syncing.get(userId);
  if (existing) return existing;
  const promise = processSales(userId).finally(() => syncing.delete(userId));
  syncing.set(userId, promise);
  return promise;
}
async function processSales(userId: string) {
  try {
    const user = await request<{ id: string }>('auth/me');
    if (user.id !== userId) return;
  } catch {
    return;
  }
  const db = await database();
  const sales = await pendingSales(userId);
  for (const sale of sales.filter((s) => s.status === 'REVIEW')) {
    try {
      const value = await request<{ resolved: boolean }>(`offline-conflicts/${sale.key}`);
      if (value.resolved) await db.delete('sales', sale.key);
    } catch {
      /* conservar el cobro hasta recibir una resolución confirmada */
    }
  }
  for (const sale of sales.filter((s) => s.status === 'PENDING')) {
    try {
      await request('sales/sync', 'POST', sale.payload);
      await db.delete('sales', sale.key);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code === 'NETWORK' ||
        (error.status && error.status >= 500)
      )
        break;
      if (error.status === 401 || error.status === 403 || error.status === 429) break;
      await db.put('sales', { ...sale, status: 'REVIEW', error: error.message });
    }
  }
  window.dispatchEvent(new Event('queue-change'));
}
