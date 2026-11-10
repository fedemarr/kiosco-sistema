import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { closeShift, currentShift, openShift, shiftStatus } from '@/modules/shifts/service';
import { checkout, quote } from '@/modules/sales/service';
import type { Actor } from '@/modules/auth/permissions';
import type { CartInput } from '@/modules/sales/schema';

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('Ciclo de turnos en PostgreSQL', () => {
  const users: Actor[] = [];
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw new Error('Solo base _test');
    for (let i = 0; i < 2; i++)
      users.push(
        await db.user.create({
          data: {
            name: `Empleado ${i}`,
            username: `shift-${crypto.randomUUID()}`,
            passwordHash: 'not-a-login',
          },
        }),
      );
  });
  afterAll(async () => {
    const ids = users.map((u) => u.id);
    await db.idempotency.deleteMany({ where: { userId: { in: ids } } });
    const ops = await db.operation.findMany({
      where: { userId: { in: ids } },
      select: { id: true },
    });
    await db.payment.deleteMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
    await db.operationItem.deleteMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
    await db.operation.deleteMany({ where: { userId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shift.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  it('dos empleados abriendo a la vez obtienen un solo turno activo', async () => {
    const results = await Promise.allSettled(
      users.map((u) => openShift(u.id, { type: 'NIGHT', openingCash: 0 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await shiftStatus();
    expect(active).toHaveLength(1);
    const shift = active[0];
    const other = users.find((u) => u.id !== shift.userId)!;
    await expect(openShift(other.id, { type: 'MORNING', openingCash: 0 })).rejects.toMatchObject({
      code: 'SHIFT_ALREADY_OPEN',
    });
    await expect(closeShift(other.id, { shiftId: shift.id, countedCash: 0 })).rejects.toMatchObject(
      { code: 'NO_OPEN_SHIFT' },
    );
    // Recargar, salir de sesión o cambiar la fecha no alteran la identidad del turno.
    expect((await currentShift(shift.userId))?.id).toBe(shift.id);
    await closeShift(shift.userId, { shiftId: shift.id, countedCash: 0 });
  });
  it('un cierre repetido no cierra el siguiente turno ni reabre el anterior', async () => {
    const first = await openShift(users[0].id, { type: 'MORNING', openingCash: 100 });
    await expect(closeShift(users[0].id, { countedCash: 100 })).rejects.toThrow();
    await closeShift(users[0].id, { shiftId: first.id, countedCash: 100 });
    expect(await currentShift(users[0].id)).toBeNull();
    const second = await openShift(users[0].id, { type: 'AFTERNOON', openingCash: 200 });
    expect(second.id).not.toBe(first.id);
    const replay = await closeShift(users[0].id, { shiftId: first.id, countedCash: 100 });
    expect(replay.id).toBe(first.id);
    expect((await currentShift(users[0].id))?.id).toBe(second.id);
    expect(
      await db.auditLog.count({
        where: {
          userId: users[0].id,
          action: 'SHIFT_CLOSED',
          detail: { path: ['shiftId'], equals: first.id },
        },
      }),
    ).toBe(1);
    await expect(
      closeShift(users[0].id, { shiftId: first.id, countedCash: 101 }),
    ).rejects.toMatchObject({ code: 'SHIFT_CLOSED' });
    await expect(
      db.shift.update({ where: { id: first.id }, data: { closedAt: null } }),
    ).rejects.toThrow();
    await expect(
      db.shift.create({
        data: { userId: users[1].id, type: 'NIGHT', openingCash: 0, businessDate: '2026-11-09' },
      }),
    ).rejects.toThrow();
    await closeShift(users[0].id, { shiftId: second.id, countedCash: 200 });
  });
  it('la base también impide dos aperturas directas concurrentes', async () => {
    const results = await Promise.allSettled(
      users.map((user) =>
        db.shift.create({
          data: {
            userId: user.id,
            type: 'MORNING',
            openingCash: 0,
            businessDate: '2026-11-09',
          },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await shiftStatus();
    expect(active).toHaveLength(1);
    await closeShift(active[0].userId, { shiftId: active[0].id, countedCash: 0 });
  });
  it('cobro y cierre concurrentes conservan un cierre exacto y rechazan ventas nuevas al turno cerrado', async () => {
    const actor = users[0];
    const shift = await openShift(actor.id, { type: 'NIGHT', openingCash: 0 });
    const cart: CartInput = {
      type: 'SALE',
      items: [{ kind: 'custom', name: 'Prueba de turno', price: 100, quantity: 1 }],
    };
    const q = await quote(actor, cart);
    const payload = {
      ...cart,
      shiftId: shift.id,
      idempotencyKey: crypto.randomUUID(),
      quoteToken: q.quoteToken,
      payments: [{ method: 'CASH' as const, amount: q.total }],
      received: q.total,
    };
    const [sale, close] = await Promise.allSettled([
      checkout(actor, payload),
      closeShift(actor.id, { shiftId: shift.id, countedCash: 0 }),
    ]);
    expect(close.status).toBe('fulfilled');
    const closed = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(closed.expectedCash).toBe(sale.status === 'fulfilled' ? q.total : 0);
    if (sale.status === 'fulfilled')
      expect((await checkout(actor, payload)).id).toBe(sale.value.id);
    await expect(
      checkout(actor, { ...payload, idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_SHIFT' });
    const next = await openShift(users[1].id, { type: 'MORNING', openingCash: 0 });
    await expect(
      checkout(actor, { ...payload, idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_SHIFT' });
    await closeShift(users[1].id, { shiftId: next.id, countedCash: 0 });
  });
});
