import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { quote, checkout, voidOperation } from '@/modules/sales/service';
import { adjustStock, saveProduct, mergeProducts } from '@/modules/stock/service';
import { syncCheckout } from '@/modules/offline/service';
import { importWorkbook, exportWorkbook } from '@/modules/stock/excel';
import ExcelJS from 'exceljs';
import { openShift, closeShift } from '@/modules/shifts/service';
import { currentShift } from '@/modules/shifts/service';
import type { Actor } from '@/modules/auth/permissions';
import type { CartInput, CheckoutInput } from '@/modules/sales/schema';
const enabled = process.env.RUN_DB_TESTS === '1';
describe.skipIf(!enabled)('PostgreSQL real: atomicidad, idempotencia y caja', () => {
  let owner: Actor;
  let seller: Actor;
  let categoryId: string;
  const tag = crypto.randomUUID().slice(0, 8);
  const users: string[] = [];
  const products: string[] = [];
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
      throw new Error('Tests requieren base _test.');
    for (const role of ['OWNER', 'SELLER'] as const) {
      const u = await db.user.create({
        data: {
          name: `Test ${role}`,
          username: `test-${role.toLowerCase()}-${tag}`,
          passwordHash: 'not-a-login',
          role,
          stockEnabled: role === 'OWNER',
        },
      });
      const actor = { ...u, mustChangePassword: false };
      if (role === 'OWNER') owner = actor;
      else seller = actor;
      users.push(u.id);
    }
    categoryId = (await db.category.create({ data: { name: `Test ${tag}` } })).id;
    await openShift(owner.id, { type: 'MORNING', openingCash: 10000 });
    await openShift(seller.id, { type: 'MORNING', openingCash: 0 });
  });
  async function product(stock: number) {
    const p = await saveProduct(owner.id, {
      name: `Producto ${crypto.randomUUID()}`,
      categoryId,
      cost: 5000,
      price: 10000,
      minStock: 2,
      trackStock: true,
    });
    products.push(p.id);
    if (stock) await adjustStock(owner.id, p.id, { type: 'RECEIPT', quantity: stock });
    return p;
  }
  async function payload(actor: Actor, pid: string, quantity = 1): Promise<CheckoutInput> {
    const cart: CartInput = {
      type: 'SALE',
      items: [{ kind: 'product', productId: pid, quantity }],
    };
    const q = await quote(actor, cart);
    const shift = await db.shift.findFirstOrThrow({ where: { userId: actor.id, closedAt: null } });
    return {
      ...cart,
      shiftId: shift.id,
      idempotencyKey: crypto.randomUUID(),
      quoteToken: q.quoteToken,
      payments: [{ method: 'MP', amount: q.total }],
    };
  }
  it('editar metadatos conserva stock y rechaza stock en payload', async () => {
    const p = await product(10);
    await saveProduct(
      owner.id,
      {
        name: 'Nombre actualizado',
        barcode: p.barcode,
        categoryId,
        cost: 5000,
        price: 10000,
        minStock: 2,
        trackStock: true,
      },
      p.id,
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
    await expect(
      saveProduct(
        owner.id,
        {
          name: 'Intento',
          categoryId,
          cost: 1,
          price: 2,
          minStock: 0,
          trackStock: true,
          stock: 1000,
        },
        p.id,
      ),
    ).rejects.toThrow();
  });
  it('dos cargas concurrentes conservan ambos movimientos', async () => {
    const p = await product(0);
    await Promise.all([
      adjustStock(owner.id, p.id, { type: 'RECEIPT', quantity: 3 }),
      adjustStock(owner.id, p.id, { type: 'RECEIPT', quantity: 7 }),
    ]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(2);
  });
  it('dos dispositivos no venden dos veces el último ítem', async () => {
    const p = await product(1);
    const a = await payload(owner, p.id);
    const b = await payload(seller, p.id);
    const results = await Promise.allSettled([checkout(owner, a), checkout(seller, b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: 'SALE' } })).toBe(1);
  });
  it('reintentar la misma clave incluso concurrentemente crea un cobro', async () => {
    const p = await product(5);
    const input = await payload(owner, p.id);
    const [a, b] = await Promise.all([checkout(owner, input), checkout(owner, input)]);
    expect(a.id).toBe(b.id);
    const again = await checkout(owner, input);
    expect(again.id).toBe(a.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
    expect(await db.operationItem.count({ where: { productId: p.id } })).toBe(1);
  });
  it('una clave no puede cambiar su contenido ni pertenecer a otro usuario', async () => {
    const p = await product(5);
    const input = await payload(owner, p.id);
    await checkout(owner, input);
    await expect(
      checkout(owner, { ...input, payments: [{ method: 'CASH', amount: 10000 }], received: 10000 }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(checkout(seller, input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('motivo obligatorio al bajar stock y rollback si falta stock', async () => {
    const p = await product(1);
    await expect(adjustStock(owner.id, p.id, { type: 'COUNT', quantity: 0 })).rejects.toThrow(
      'motivo',
    );
    const input = await payload(owner, p.id);
    await adjustStock(owner.id, p.id, { type: 'COUNT', quantity: 0, note: 'Rotura' });
    await expect(checkout(owner, input)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await db.idempotency.count({ where: { key: input.idempotencyKey } })).toBe(0);
  });
  it('anular devuelve stock una sola vez', async () => {
    const p = await product(3);
    const operation = await checkout(owner, await payload(owner, p.id));
    await voidOperation(owner, operation.id, 'Error de carga');
    await voidOperation(owner, operation.id, 'Error de carga');
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: 'VOID' } })).toBe(1);
  });
  it('cierre incluye parte efectivo de mixto y diferencia', async () => {
    const p = await product(3);
    const input = await payload(seller, p.id);
    const total = input.payments[0].amount;
    await checkout(seller, {
      ...input,
      payments: [
        { method: 'CASH', amount: 4000 },
        { method: 'MP', amount: total - 4000 },
      ],
      received: 5000,
    });
    const closed = await closeShift(seller.id, { countedCash: 3500 });
    expect(closed.expectedCash).toBe(4000);
    expect(closed.difference).toBe(-500);
  });
  it('offline verifica identidad firmada y total actual antes de registrar', async () => {
    const p = await product(5);
    const input = await payload(owner, p.id);
    const shift = await currentShift(owner.id);
    const offline: CheckoutInput = {
      ...input,
      quoteToken: undefined,
      offline: true,
      offlineToken: shift!.offlineToken,
      expectedTotal: input.payments[0].amount,
    };
    await expect(
      checkout(seller, { ...offline, idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'OFFLINE_PERMIT' });
    await expect(
      checkout(owner, { ...offline, expectedTotal: 1, idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const result = await checkout(owner, offline);
    expect((await checkout(owner, offline)).id).toBe(result.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
  });
  afterAll(async () => {
    if (!users.length) return;
    const ops = await db.operation.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    const ids = ops.map((o) => o.id);
    await db.offlineConflict.deleteMany({ where: { userId: { in: users } } });
    await db.idempotency.deleteMany({ where: { userId: { in: users } } });
    await db.payment.deleteMany({ where: { operationId: { in: ids } } });
    await db.operationItem.deleteMany({ where: { operationId: { in: ids } } });
    await db.operation.deleteMany({ where: { id: { in: ids } } });
    await db.stockMovement.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.shift.deleteMany({ where: { userId: { in: users } } });
    await db.product.deleteMany({ where: { id: { in: products } } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  it('anulación después de fusión repone en el producto destino', async () => {
    const source = await product(3);
    const target = await product(2);
    const operation = await checkout(owner, await payload(owner, source.id));
    await mergeProducts(owner.id, target.id, source.id);
    await voidOperation(owner, operation.id, 'Anulación posterior a fusión');
    expect((await db.product.findUniqueOrThrow({ where: { id: source.id } })).stock).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: target.id } })).stock).toBe(5);
  });
  it('un cobro rechazado al sincronizar queda visible para el dueño en DB', async () => {
    const p = await product(2);
    const input = await payload(owner, p.id);
    const shift = await currentShift(owner.id);
    await expect(
      syncCheckout(owner, {
        ...input,
        quoteToken: undefined,
        offline: true,
        offlineToken: shift!.offlineToken,
        expectedTotal: 1,
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect(
      await db.offlineConflict.findUnique({ where: { key: input.idempotencyKey } }),
    ).toMatchObject({ userId: owner.id, code: 'QUOTE_CHANGED', resolved: false });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2);
  });
  it('Excel viejo conserva stock existente, carga solo el inicial nuevo y marca stock bajo', async () => {
    const p = await product(4);
    const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Productos');
    sheet.addRows([
      ['código', 'nombre', 'costo', 'venta', 'stock', 'mínimo', 'categoría'],
      [p.barcode, 'Producto Excel', 50, 130, 2, 5, category.name],
      [`EXCEL-${tag}`, 'Producto nuevo por Excel', 10, 20, 7, 2, category.name],
    ]);
    const bytes = await workbook.xlsx.writeBuffer();
    const array = Uint8Array.from(new Uint8Array(bytes)).buffer;
    await importWorkbook(owner.id, array);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      price: 13000,
      cost: 5000,
      stock: 4,
      minStock: 5,
    });
    const added = await db.product.findUniqueOrThrow({ where: { barcode: `EXCEL-${tag}` } });
    products.push(added.id);
    expect(added.stock).toBe(7);
    await importWorkbook(owner.id, array);
    expect((await db.product.findUniqueOrThrow({ where: { id: added.id } })).stock).toBe(7);
    expect(await db.stockMovement.count({ where: { productId: added.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: 'COUNT' } })).toBe(0);
    const output = await exportWorkbook('products', new URL('http://localhost'));
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(output);
    const match = exported.worksheets[0]
      .getRows(2, exported.worksheets[0].rowCount - 1)
      ?.find((r) => r.getCell(1).text === p.barcode);
    expect(match?.getCell(5).value).toBe(4);
    expect(match?.getCell(5).fill).toMatchObject({
      type: 'pattern',
      fgColor: { argb: 'FFFFE699' },
    });
  });
  it('reintentos simultáneos de carga tienen un solo movimiento y rechazan datos distintos', async () => {
    const p = await product(0);
    const requestKey = crypto.randomUUID();
    const command = { type: 'RECEIPT', quantity: 7, requestKey, note: 'Remito único' };
    const [a, b] = await Promise.all([
      adjustStock(owner.id, p.id, command),
      adjustStock(owner.id, p.id, command),
    ]);
    expect(a.id).toBe(b.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(1);
    await expect(adjustStock(owner.id, p.id, { ...command, quantity: 8 })).rejects.toMatchObject({
      code: 'STOCK_REQUEST_CONFLICT',
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
  });
  it('un conteo abierto antes de otra carga se rechaza y conserva el ingreso', async () => {
    const p = await product(2);
    await adjustStock(owner.id, p.id, { type: 'RECEIPT', quantity: 3 });
    await expect(
      adjustStock(owner.id, p.id, {
        type: 'COUNT',
        quantity: 1,
        expectedStock: 2,
        note: 'Conteo anterior',
        requestKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'STOCK_CHANGED' });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: 'COUNT' } })).toBe(0);
  });
  it('una carga y una venta simultáneas suman y descuentan sin pisarse', async () => {
    const p = await product(10);
    const sale = await payload(owner, p.id, 2);
    await Promise.all([
      adjustStock(owner.id, p.id, {
        type: 'RECEIPT',
        quantity: 5,
        requestKey: crypto.randomUUID(),
      }),
      checkout(owner, sale),
    ]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(13);
    const ledger = await db.stockMovement.aggregate({
      where: { productId: p.id },
      _sum: { quantity: true },
    });
    expect(ledger._sum.quantity).toBe(13);
  });
  it('conteo y carga concurrentes conservan el ingreso o rechazan el conteo desactualizado', async () => {
    const p = await product(10);
    const [count, receipt] = await Promise.allSettled([
      adjustStock(owner.id, p.id, {
        type: 'COUNT',
        quantity: 8,
        expectedStock: 10,
        note: 'Conteo físico',
        requestKey: crypto.randomUUID(),
      }),
      adjustStock(owner.id, p.id, {
        type: 'RECEIPT',
        quantity: 5,
        requestKey: crypto.randomUUID(),
      }),
    ]);
    expect(receipt.status).toBe('fulfilled');
    if (count.status === 'rejected') expect(count.reason).toMatchObject({ code: 'STOCK_CHANGED' });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(
      count.status === 'fulfilled' ? 13 : 15,
    );
  });
  it('consumo empleado y retiro a costo descuentan cantidades y anulan una sola vez', async () => {
    const p = await product(10);
    const shift = await currentShift(owner.id);
    const cart: CartInput = {
      type: 'EMPLOYEE',
      items: [{ kind: 'product', productId: p.id, quantity: 2 }],
    };
    const q = await quote(owner, cart);
    const employee = await checkout(owner, {
      ...cart,
      shiftId: shift!.id,
      idempotencyKey: crypto.randomUUID(),
      quoteToken: q.quoteToken,
      payments: [{ method: 'MP', amount: q.total }],
    });
    expect(employee).toMatchObject({ total: 16000, cost: 10000, adjustment: -4000 });
    const withdrawal: CartInput = {
      type: 'OWNER',
      items: [{ kind: 'product', productId: p.id, quantity: 3 }],
      note: 'Retiro de prueba',
    };
    const wq = await quote(owner, withdrawal);
    const taken = await checkout(owner, {
      ...withdrawal,
      shiftId: shift!.id,
      idempotencyKey: crypto.randomUUID(),
      quoteToken: wq.quoteToken,
      payments: [],
    });
    expect(taken).toMatchObject({ total: 15000, cost: 15000 });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
    await Promise.all([
      voidOperation(owner, employee.id, 'Anular prueba'),
      voidOperation(owner, taken.id, 'Anular prueba'),
    ]);
    await voidOperation(owner, taken.id, 'Repetir anulación');
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
  });
  it('un producto repetido no permite vender más unidades que el stock disponible', async () => {
    const p = await product(3);
    await expect(
      quote(owner, {
        type: 'SALE',
        items: [
          { kind: 'product', productId: p.id, quantity: 2 },
          { kind: 'product', productId: p.id, quantity: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });
});
