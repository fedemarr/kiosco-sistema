import { database, pendingSales } from './queue';
import { request } from '@/lib/client';
import type { Actor } from '@/modules/auth/permissions';
import type { Category, Product, ProductList, Quick, Shift } from '@/lib/types';
export type Snapshot = {
  user: Actor;
  shift: Shift | null;
  quick: Quick[];
  categories: Category[];
  products: Product[];
  savedAt: string;
  observedAt?: number;
};
export async function saveSnapshot(
  user: Actor,
  shift: Shift | null,
  quick: Quick[],
  categories: Category[],
  observedAt = Date.now(),
) {
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const old = (await tx.store.get(user.id)) as Snapshot | undefined;
  // Una consulta iniciada antes no puede reemplazar una observación más nueva.
  if (
    (old?.observedAt || 0) > observedAt ||
    (shift && (await tx.store.get(`closed-shift:${shift.id}`)))
  ) {
    await tx.done;
    return;
  }
  if (old?.shift && old.shift.id !== shift?.id)
    await tx.store.put(true, `closed-shift:${old.shift.id}`);
  const value: Snapshot = {
    user,
    shift,
    quick,
    categories,
    products: old?.products || [],
    savedAt: new Date().toISOString(),
    observedAt,
  };
  await tx.store.put(value, user.id);
  await tx.store.put(user.id, 'active');
  await tx.done;
}
// La marca persiste entre pestañas/reinicios e impide revivir una copia vieja.
export async function markShiftClosed(userId: string, shiftId: string) {
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  await tx.store.put(true, `closed-shift:${shiftId}`);
  const snapshot = (await tx.store.get(userId)) as Snapshot | undefined;
  if (snapshot?.shift?.id === shiftId) await tx.store.put({ ...snapshot, shift: null }, userId);
  await tx.done;
}
export async function cacheCatalog(userId: string, products: Product[]) {
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const current = (await tx.store.get(userId)) as Snapshot | undefined;
  if (!current) return;
  const map = new Map(current.products.map((p) => [p.id, p]));
  for (const p of products) map.set(p.id, p);
  await tx.store.put({ ...current, products: [...map.values()] }, userId);
  await tx.done;
}
export async function warmCatalog(userId: string) {
  const all: Product[] = [];
  for (let page = 1; page <= 100; page++) {
    const value = await request<ProductList>(`catalog?page=${page}`);
    all.push(...value.products);
    if (page * 60 >= value.total) break;
  }
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const current = (await tx.store.get(userId)) as Snapshot | undefined;
  if (current) await tx.store.put({ ...current, products: all }, userId);
  await tx.done;
}
export async function readSnapshot(userId?: string): Promise<Snapshot | null> {
  const db = await database();
  const id = userId || ((await db.get('snapshots', 'active')) as string | undefined);
  if (!id) return null;
  const snapshot = (await db.get('snapshots', id)) as Snapshot | undefined;
  if (!snapshot || Date.now() - new Date(snapshot.savedAt).getTime() > 7 * 86400000) return null;
  if (snapshot.shift && (await db.get('snapshots', `closed-shift:${snapshot.shift.id}`)))
    snapshot.shift = null;
  const pending = await pendingSales(id, true);
  const reserved = new Map<string, number>();
  for (const sale of pending)
    for (const item of sale.payload.items)
      if (item.kind === 'product')
        reserved.set(item.productId, (reserved.get(item.productId) || 0) + item.quantity);
  return {
    ...snapshot,
    products: snapshot.products.map((p) => ({
      ...p,
      stock: Math.max(0, p.stock - (reserved.get(p.id) || 0)),
    })),
  };
}
export async function clearOfflineSession() {
  await (await database()).delete('snapshots', 'active');
}
