import { isNight } from '@/lib/format';
import { AppError } from '@/lib/errors';
export function calculateTotals(
  subtotal: number,
  cost: number,
  type: 'SALE' | 'EMPLOYEE' | 'OWNER',
  date = new Date(),
) {
  if (![subtotal, cost].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000))
    throw new AppError('El importe supera el máximo permitido.');
  const adjustment =
    type === 'EMPLOYEE'
      ? -Math.round(subtotal * 0.2)
      : type === 'SALE' && isNight(date)
        ? Math.round(subtotal * 0.1)
        : 0;
  const total = type === 'OWNER' ? cost : subtotal + adjustment;
  if (!Number.isSafeInteger(total) || total > 100_000_000 || total < 0)
    throw new AppError('El total supera el máximo permitido.');
  return { subtotal, adjustment, total, cost, night: type === 'SALE' && isNight(date) };
}
export function validatePayments(
  total: number,
  type: string,
  payments: { method: string; amount: number }[],
  received?: number,
) {
  if (type === 'OWNER') {
    if (payments.length) throw new AppError('El retiro del dueño no lleva cobro.');
    return;
  }
  if (
    !payments.length ||
    payments.length > 2 ||
    new Set(payments.map((p) => p.method)).size !== payments.length
  )
    throw new AppError('Revisá los medios de pago.');
  if (payments.length === 2 && !payments.every((p) => ['CASH', 'MP'].includes(p.method)))
    throw new AppError('El pago mixto es efectivo más Mercado Pago.');
  if (
    payments.some((p) => !Number.isInteger(p.amount) || p.amount < 0) ||
    payments.reduce((sum, p) => sum + p.amount, 0) !== total
  )
    throw new AppError('Los importes de los pagos deben sumar exactamente el total.');
  const cash = payments.find((p) => p.method === 'CASH')?.amount;
  if (cash !== undefined && (received === undefined || received < cash))
    throw new AppError('El efectivo recibido no alcanza para cobrar.');
}
