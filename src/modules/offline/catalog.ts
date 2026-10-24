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
};
export async function saveSnapshot(
  user: Actor,
  shift: Shift | null,
  quick: Quick[],
  categories: Category[],
) {
  const db = await database();
  const old = (await db.get('snapshots', user.id)) as Snapshot | undefined;
  const value: Snapshot = {
    user,
    shift,
    quick,
    categories,
    products: old?.products || [],
    savedAt: new Date().toISOString(),
  };
  await db.put('snapshots', value, user.id);
  await db.put('snapshots', user.id, 'active');
}
export async function cacheCatalog(userId: string, products: Product[]) {
  const db = await database();
  const current = (await db.get('snapshots', userId)) as Snapshot | undefined;
  if (!current) return;
  const map = new Map(current.products.map((p) => [p.id, p]));
  for (const p of products) map.set(p.id, p);
  await db.put('snapshots', { ...current, products: [...map.values()] }, userId);
}
export async function warmCatalog(userId: string) {
  const all: Product[] = [];
  for (let page = 1; page <= 100; page++) {
    const value = await request<ProductList>(`catalog?page=${page}`);
    all.push(...value.products);
    if (page * 60 >= value.total) break;
  }
  const db = await database();
  const current = (await db.get('snapshots', userId)) as Snapshot | undefined;
  if (current) await db.put('snapshots', { ...current, products: all }, userId);
}
export async function readSnapshot(userId?: string): Promise<Snapshot | null> {
  const db = await database();
  const id = userId || ((await db.get('snapshots', 'active')) as string | undefined);
  if (!id) return null;
  const snapshot = (await db.get('snapshots', id)) as Snapshot | undefined;
  if (!snapshot || Date.now() - new Date(snapshot.savedAt).getTime() > 7 * 86400000) return null;
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
