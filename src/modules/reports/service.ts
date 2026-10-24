import { z } from 'zod';
import { db } from '@/lib/db';
import { businessDate } from '@/lib/format';
import { AppError } from '@/lib/errors';
export function reportRange(url: URL) {
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const from = day.parse(url.searchParams.get('from') || businessDate());
  const to = day.parse(url.searchParams.get('to') || from);
  if (from > to || new Date(to).getTime() - new Date(from).getTime() > 92 * 86400000)
    throw new AppError('Elegí un rango válido de hasta 93 días.');
  return { from, to };
}
export async function report(url: URL) {
  const { from, to } = reportRange(url);
  const shifts = await db.shift.findMany({
    where: { businessDate: { gte: from, lte: to } },
    orderBy: { openedAt: 'desc' },
    include: {
      user: { select: { name: true, id: true } },
      operations: { where: { voidedAt: null }, include: { items: true, payments: true } },
    },
    take: 1000,
  });
  const operations = shifts.flatMap((s) => s.operations).filter((o) => o.type !== 'OWNER');
  const sales = operations.filter((o) => o.type === 'SALE');
  const employee = operations.filter((o) => o.type === 'EMPLOYEE');
  const total = operations.reduce((s, o) => s + o.total, 0);
  const cost = operations.reduce((s, o) => s + o.cost, 0);
  const payments = { CASH: 0, MP: 0, CARD: 0 };
  for (const p of operations.flatMap((o) => o.payments)) payments[p.method] += p.amount;
  const products = new Map<string, { name: string; quantity: number; total: number }>();
  for (const item of sales.flatMap((o) => o.items)) {
    const key = item.productId || item.name;
    const p = products.get(key) || { name: item.name, quantity: 0, total: 0 };
    p.quantity += item.quantity;
    p.total += item.subtotal;
    products.set(key, p);
  }
  const days = new Map<string, { day: string; total: number; profit: number }>();
  const employees = new Map<
    string,
    { name: string; count: number; total: number; saleTotal: number }
  >();
  for (const s of shifts) {
    const d = days.get(s.businessDate) || { day: s.businessDate, total: 0, profit: 0 };
    const e = employees.get(s.userId) || { name: s.user.name, count: 0, total: 0, saleTotal: 0 };
    for (const o of s.operations.filter((o) => o.type !== 'OWNER')) {
      d.total += o.total;
      d.profit += o.total - o.cost;
      e.total += o.total;
      if (o.type === 'SALE') {
        e.count++;
        e.saleTotal += o.total;
      }
    }
    days.set(s.businessDate, d);
    employees.set(s.userId, e);
  }
  const [lowStock, pendingRequests] = await Promise.all([
    db.$queryRaw<
      { id: string; name: string; stock: number; min_stock: number }[]
    >`SELECT id, name, stock, min_stock FROM products WHERE deleted_at IS NULL AND track_stock AND stock <= min_stock ORDER BY stock LIMIT 100`,
    db.stockRequest.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    from,
    to,
    total,
    cost,
    profit: total - cost,
    saleTotal: sales.reduce((s, o) => s + o.total, 0),
    employeeTotal: employee.reduce((s, o) => s + o.total, 0),
    saleCount: sales.length,
    payments,
    top: [...products.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    employees: [...employees.entries()].map(([id, e]) => ({
      id,
      ...e,
      average: e.count ? Math.round(e.saleTotal / e.count) : 0,
    })),
    shifts,
    lowStock,
    pendingRequests,
    truncated: shifts.length === 1000,
  };
}
