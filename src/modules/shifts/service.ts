import { z } from 'zod';
import { db } from '@/lib/db';
import { transaction } from '@/lib/transaction';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { businessDate } from '@/lib/format';
import { cents } from '@/modules/stock/service';
import { offlinePermit } from '@/modules/offline/permit';
export async function currentShift(userId: string) {
  const shift = await db.shift.findFirst({
    where: { userId, closedAt: null },
    include: {
      operations: {
        where: { voidedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { payments: true, items: true },
      },
    },
  });
  if (!shift) return null;
  const grouped = await db.payment.groupBy({
    by: ['method'],
    where: { operation: { shiftId: shift.id, voidedAt: null } },
    _sum: { amount: true },
  });
  const totals = { CASH: 0, MP: 0, CARD: 0 };
  for (const p of grouped) totals[p.method] = p._sum.amount || 0;
  return { ...shift, totals, offlineToken: await offlinePermit(userId, shift.id) };
}
export async function openShift(userId: string, body: unknown) {
  const input = z
    .object({ type: z.enum(['MORNING', 'AFTERNOON', 'NIGHT']), openingCash: cents })
    .strict()
    .parse(body);
  return transaction(async (tx) => {
    if (await tx.shift.findFirst({ where: { userId, closedAt: null } }))
      throw new AppError('Ya tenés un turno abierto.', 409);
    const shift = await tx.shift.create({
      data: { ...input, userId, businessDate: businessDate(new Date(), input.type === 'NIGHT') },
    });
    await audit(tx, userId, 'SHIFT_OPENED', { shiftId: shift.id, ...input });
    return shift;
  });
}
export async function closeShift(userId: string, body: unknown) {
  const input = z.object({ countedCash: cents }).strict().parse(body);
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shifts WHERE user_id = ${userId}::uuid AND closed_at IS NULL FOR UPDATE`;
    const shift = await tx.shift.findFirst({
      where: { userId, closedAt: null },
      include: {
        operations: { where: { voidedAt: null }, include: { payments: true, items: true } },
      },
    });
    if (!shift) throw new AppError('No tenés un turno abierto.', 409);
    const expectedCash =
      shift.openingCash +
      shift.operations
        .flatMap((o) => o.payments)
        .filter((p) => p.method === 'CASH')
        .reduce((s, p) => s + p.amount, 0);
    const result = await tx.shift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        countedCash: input.countedCash,
        expectedCash,
        difference: input.countedCash - expectedCash,
      },
    });
    await audit(tx, userId, 'SHIFT_CLOSED', {
      shiftId: shift.id,
      expectedCash,
      countedCash: input.countedCash,
      difference: result.difference,
    });
    return { ...result, operations: shift.operations };
  });
}
