import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomInt, randomUUID } from 'node:crypto';
import {
  planLegacy,
  legacyDate,
  legacyMoney,
  legacyId,
  importLegacy,
  LEGACY_SOURCE,
} from '../src/modules/imports/legacy';
import { db } from '../src/lib/db';
import { currentShift, openShift, closeShift } from '../src/modules/shifts/service';
import { adjustStock } from '../src/modules/stock/service';
import { voidOperation } from '../src/modules/sales/service';
import { report } from '../src/modules/reports/service';
const tag = randomUUID();
const base = randomInt(1000000, 2000000);
const input = {
  products: [
    {
      id: base,
      codigo_barra: `SKU-${tag}`,
      nombre: `Producto ${tag}`,
      precio_costo: 5,
      precio_venta: 10,
      stock: 5,
      stock_minimo: 1,
      categoria: 'bebida',
    },
    {
      id: base + 1,
      codigo_barra: '012-' + tag,
      nombre: 'Agua caliente',
      precio_costo: 0,
      precio_venta: 100,
      stock: 99999302,
      stock_minimo: 0,
      categoria: 'general',
    },
    {
      id: base + 2,
      codigo_barra: 'FREE-' + tag,
      nombre: 'Pendiente de precio',
      precio_costo: 0,
      precio_venta: 0,
      stock: 3,
      stock_minimo: 1,
      categoria: 'general',
    },
    {
      id: base + 3,
      codigo_barra: ` SKU-${tag}`,
      nombre: '.',
      precio_costo: 1,
      precio_venta: 3,
      stock: 2,
      stock_minimo: 1,
      categoria: '.',
    },
  ],
  users: [
    {
      id: base,
      nombre: 'Vendedor ' + tag,
      username: 'legacy-' + tag,
      rol: 'vendedor',
      activo: true,
      stock_habilitado: false,
      creado_en: '2020-01-01T12:00:00',
    },
  ],
  shifts: [
    {
      id: base,
      usuario: 'Vendedor ' + tag,
      tipo: 'noche',
      inicio: '2020-01-02T01:00:00',
      cierre: null,
      cerrado: false,
      total_ventas: 15,
      cantidad_ventas: 2,
      monto_apertura: 0,
      monto_cierre: null,
      detalle_ventas: [
        {
          id: base,
          total: 10,
          medio_pago: 'efectivo',
          fecha: '2020-01-02T01:10:00',
          items: [{ nombre: `Producto ${tag}`, cantidad: 1, precio_unitario: 10, subtotal: 10 }],
        },
        {
          id: base + 1,
          total: 5,
          medio_pago: 'mixto',
          fecha: '2020-01-02T01:20:00',
          items: [
            { nombre: 'Venta rápida histórica', cantidad: 1, precio_unitario: 5, subtotal: 5 },
          ],
        },
      ],
    },
  ],
};
const plan = planLegacy(input);
test('plan de migración conserva importes, fechas argentinas, códigos y anomalías', () => {
  expect(legacyDate('2026-10-23T08:51:29').toISOString()).toBe('2026-10-23T11:51:29.000Z');
  expect(legacyMoney(0.1 + 0.2)).toBe(30);
  expect(plan.products[0].category).toBe('Bebidas');
  expect(plan.products[1].trackStock).toBe(false);
  expect(plan.products[2]).toMatchObject({ price: 0, sellable: false, stock: 3 });
  expect(plan.products[3].barcode).toBe(`LEGACY-${base + 3}`);
  expect(plan.summary).toMatchObject({
    totalCents: 1500,
    mixedWithoutSplit: 1,
    mixedWithoutSplitCents: 500,
    trackedStock: 10,
  });
  expect(plan.summary.byDay).toEqual([{ day: '2020-01-01', count: 2, total: 1500 }]);
  expect(() =>
    planLegacy({ ...input, shifts: [{ ...input.shifts[0], total_ventas: 16 }] }),
  ).toThrow('Totales no conciliados');
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('importación histórica transaccional', () => {
  let ownerId: string;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw new Error('Solo base de pruebas.');
    if (await db.importBatch.findUnique({ where: { source: LEGACY_SOURCE } }))
      throw new Error('La fuente ya existe en la base de pruebas; no se sobrescribe.');
    ownerId = (
      await db.user.create({
        data: {
          username: 'migration-owner-' + tag,
          name: 'Dueño de prueba',
          role: 'OWNER',
          passwordHash: 'fixture-disabled',
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (!ownerId) return;
    const userId = legacyId('user', base);
    const productIds = plan.products.map((p) => p.id);
    await db.operationItem.deleteMany({ where: { operation: { userId } } });
    await db.payment.deleteMany({ where: { operation: { userId } } });
    await db.operation.deleteMany({ where: { userId } });
    await db.shift.deleteMany({ where: { userId } });
    await db.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.auditLog.deleteMany({ where: { userId: { in: [ownerId, userId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    await db.importBatch.deleteMany({ where: { source: LEGACY_SOURCE, checksum: plan.checksum } });
    await db.$disconnect();
  });
  test('una conciliación fallida revierte el lote completo', async () => {
    await expect(
      importLegacy(
        db,
        { ...plan, summary: { ...plan.summary, sales: 999 } },
        ownerId,
        async () => {},
      ),
    ).rejects.toThrow('conciliación');
    expect(await db.product.count({ where: { id: { in: plan.products.map((p) => p.id) } } })).toBe(
      0,
    );
    expect(await db.user.count({ where: { id: legacyId('user', base) } })).toBe(0);
    expect(await db.importBatch.count({ where: { source: LEGACY_SOURCE } })).toBe(0);
  });
  test('conserva stock actual, totales y pagos sin inventar costos ni caja anterior', async () => {
    let usernames: string[] = [];
    const result = await importLegacy(db, plan, ownerId, async (c) => {
      usernames = c.map((v) => v.username);
    });
    expect(result.replayed).toBe(false);
    expect(usernames).toEqual([input.users[0].username]);
    expect((await db.product.findUniqueOrThrow({ where: { id: plan.products[0].id } })).stock).toBe(
      5,
    );
    expect(await currentShift(legacyId('user', base))).toBeNull();
    const d = await report(new URL('http://localhost/reports?from=2020-01-01&to=2020-01-01'));
    expect(d).toMatchObject({
      total: 1500,
      cost: null,
      profit: null,
      unknownCostCount: 2,
      saleCount: 2,
      payments: { CASH: 1000, MP: 0, CARD: 0, UNALLOCATED: 500 },
    });
    const historical = await db.shift.findUniqueOrThrow({ where: { id: legacyId('shift', base) } });
    expect(historical).toMatchObject({
      archived: true,
      closedAt: null,
      expectedCash: null,
      difference: null,
    });
    expect(
      await db.stockMovement.count({
        where: { reference: LEGACY_SOURCE, productId: { in: plan.products.map((p) => p.id) } },
      }),
    ).toBe(4);
  });
  test('se puede abrir un turno nuevo y el replay no pisa movimientos posteriores', async () => {
    const userId = legacyId('user', base);
    await openShift(userId, { type: 'MORNING', openingCash: 0 });
    expect(await currentShift(userId)).not.toBeNull();
    await closeShift(userId, { countedCash: 0 });
    await adjustStock(ownerId, plan.products[0].id, {
      type: 'RECEIPT',
      quantity: 2,
      note: 'Movimiento posterior al importador',
    });
    expect(
      (
        await importLegacy(db, plan, ownerId, async () => {
          throw new Error('No regenerar claves');
        })
      ).replayed,
    ).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: plan.products[0].id } })).stock).toBe(
      7,
    );
    const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    await expect(
      voidOperation(owner, legacyId('sale', base), 'Prueba de consulta histórica'),
    ).rejects.toThrow('históricas');
    expect((await db.product.findUniqueOrThrow({ where: { id: plan.products[0].id } })).stock).toBe(
      7,
    );
  });
});
