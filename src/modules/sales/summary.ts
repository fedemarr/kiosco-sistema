import type { Operation } from '@/lib/types';
export function soldItems(operations: Pick<Operation, 'type' | 'items'>[]) {
  const grouped = new Map<string, { name: string; quantity: number; subtotal: number }>();
  for (const item of operations.filter((o) => o.type === 'SALE').flatMap((o) => o.items)) {
    const row = grouped.get(item.name) || { name: item.name, quantity: 0, subtotal: 0 };
    row.quantity += item.quantity;
    row.subtotal += item.subtotal;
    grouped.set(item.name, row);
  }
  return [...grouped.values()].sort((a, b) => b.subtotal - a.subtotal);
}
