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
  catalogVersions?: Record<string, number>;
};
// Orden de inicio de lecturas compartido entre pestañas, independiente del reloj de la PC.
export async function beginCatalogRead(userId: string) {
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const key = `catalog-read:${userId}`;
  const previous = Number(await tx.store.get(key)) || 0;
  const next = previous + 1;
  await tx.store.put(next, key);
  await tx.done;
  return next;
}
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
    catalogVersions: old?.catalogVersions || {},
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
export async function cacheCatalog(userId: string, products: Product[], observation: number) {
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const current = (await tx.store.get(userId)) as Snapshot | undefined;
  if (!current) return;
  const map = new Map(current.products.map((p) => [p.id, p]));
  const versions = { ...current.catalogVersions };
  for (const p of products) {
    if ((versions[p.id] || 0) > observation) continue;
    map.set(p.id, p);
    versions[p.id] = observation;
  }
  await tx.store.put(
    { ...current, products: [...map.values()], catalogVersions: versions },
    userId,
  );
  await tx.done;
}
export async function warmCatalog(userId: string) {
  const started = await beginCatalogRead(userId);
  const all: Product[] = [];
  const versions: Record<string, number> = {};
  for (let page = 1; page <= 100; page++) {
    const observation = page === 1 ? started : await beginCatalogRead(userId);
    const value = await request<ProductList>(`catalog?page=${page}`);
    all.push(...value.products);
    for (const product of value.products) versions[product.id] = observation;
    if (page * 60 >= value.total) break;
  }
  const db = await database();
  const tx = db.transaction('snapshots', 'readwrite');
  const current = (await tx.store.get(userId)) as Snapshot | undefined;
  if (current) {
    const products = new Map(all.map((product) => [product.id, product]));
    for (const product of current.products) {
      const version = current.catalogVersions?.[product.id] || 0;
      if (version > (versions[product.id] || started)) {
        products.set(product.id, product);
        versions[product.id] = version;
      }
    }
    await tx.store.put(
      { ...current, products: [...products.values()], catalogVersions: versions },
      userId,
    );
  }
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
