import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { normalizeUsername, businessDate } from '@/lib/format';

export const LEGACY_SOURCE = 'kiosco-json-2026-10-23';
const nonnegative = z.number().finite().min(0);
const legacyProduct = z
  .object({
    id: z.number().int().positive(),
    codigo_barra: z.string(),
    nombre: z.string().min(1),
    precio_costo: nonnegative,
    precio_venta: nonnegative,
    stock: nonnegative.int(),
    stock_minimo: nonnegative.int(),
    categoria: z.string(),
  })
  .passthrough();
const legacyUser = z
  .object({
    id: z.number().int().positive(),
    nombre: z.string().min(1),
    username: z.string().min(1),
    rol: z.enum(['dueño', 'admin', 'vendedor']),
    activo: z.boolean(),
    stock_habilitado: z.boolean(),
    creado_en: z.string(),
  })
  .passthrough();
const legacyItem = z
  .object({
    nombre: z.string().min(1),
    cantidad: z.number().int().positive(),
    precio_unitario: nonnegative,
    subtotal: nonnegative,
  })
  .passthrough();
const legacySale = z
  .object({
    id: z.number().int().positive(),
    total: nonnegative,
    medio_pago: z.enum(['efectivo', 'mercadopago', 'tarjeta', 'mixto']),
    fecha: z.string(),
    items: z.array(legacyItem).min(1),
  })
  .passthrough();
const legacyShift = z
  .object({
    id: z.number().int().positive(),
    usuario: z.string(),
    tipo: z.enum(['mañana', 'tarde', 'noche']),
    inicio: z.string(),
    cierre: z.string().nullable(),
    cerrado: z.boolean(),
    total_ventas: nonnegative,
    cantidad_ventas: nonnegative.int(),
    monto_apertura: nonnegative,
    monto_cierre: nonnegative.nullable(),
    detalle_ventas: z.array(legacySale),
  })
  .passthrough();
export type LegacyInput = { products: unknown; users: unknown; shifts: unknown };
export const legacyId = (kind: string, id: string | number) => {
  const hex = createHash('sha256').update(`${LEGACY_SOURCE}:${kind}:${id}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export function legacyMoney(amount: number) {
  const value = Math.round(amount * 100);
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
    throw new Error('Importe fuera de rango en la fuente.');
  return value;
}
export function legacyDate(value: string) {
  // El sistema anterior guardaba timestamps sin zona en hora argentina.
  const input = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}-03:00`;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return date;
}
const normalized = (v: string) => v.trim().toLocaleLowerCase('es-AR');
const categoryAliases: Record<string, string> = {
  '.': 'General',
  general: 'General',
  bebida: 'Bebidas',
  bebidas: 'Bebidas',
  jugos: 'Bebidas',
  golosina: 'Golosinas',
  golosinas: 'Golosinas',
  alfajores: 'Golosinas',
  gomitas: 'Golosinas',
  snack: 'Snacks',
  snacks: 'Snacks',
  galletitas: 'Galletitas',
  'art varios': 'Artículos varios',
  'art variados': 'Artículos varios',
  'articulos varios': 'Artículos varios',
  higiene: 'Higiene',
  cigarrillos: 'Cigarrillos',
  helados: 'Helados',
  comida: 'Comidas',
  comidas: 'Comidas',
};
function unique(values: (string | number)[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`IDs duplicados: ${label}.`);
}
export function planLegacy(input: LegacyInput) {
  const products = z.array(legacyProduct).min(1).parse(input.products);
  const users = z.array(legacyUser).min(1).parse(input.users);
  const shifts = z.array(legacyShift).parse(input.shifts);
  unique(
    products.map((p) => p.id),
    'productos',
  );
  unique(
    users.map((u) => u.id),
    'usuarios',
  );
  unique(
    users.map((u) => normalizeUsername(u.username)),
    'nombres de usuario',
  );
  unique(
    shifts.map((s) => s.id),
    'turnos',
  );
  const sales = shifts.flatMap((s) => s.detalle_ventas);
  unique(
    sales.map((s) => s.id),
    'ventas',
  );
  for (const s of shifts) {
    legacyDate(s.inicio);
    if (s.cierre) legacyDate(s.cierre);
    if (s.cerrado !== !!s.cierre)
      throw new Error(`Estado de cierre inconsistente en turno ${s.id}.`);
    if (
      s.cantidad_ventas !== s.detalle_ventas.length ||
      legacyMoney(s.total_ventas) !==
        s.detalle_ventas.reduce((sum, v) => sum + legacyMoney(v.total), 0)
    )
      throw new Error(`Totales no conciliados en turno ${s.id}.`);
    if (users.filter((u) => normalized(u.nombre) === normalized(s.usuario)).length !== 1)
      throw new Error(`No se puede identificar al empleado del turno ${s.id}.`);
  }
  for (const s of sales) {
    legacyDate(s.fecha);
    legacyMoney(s.total);
    for (const i of s.items) {
      legacyMoney(i.precio_unitario);
      legacyMoney(i.subtotal);
    }
  }
  const usedBarcodes = new Set(products.map((p) => p.codigo_barra.trim()).filter(Boolean));
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const key = p.codigo_barra.trim();
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  const changes: { id: number; original: string; barcode: string; reason: string }[] = [];
  const plannedProducts = products.map((p) => {
    let barcode = p.codigo_barra.trim();
    const group = groups.get(barcode) || [];
    // Preferir el código que ya era canónico. Los duplicados se conservan con código interno.
    const keeper = group.find((x) => x.codigo_barra === barcode) || group[0];
    if (!barcode || (group.length > 1 && keeper.id !== p.id)) {
      barcode = `LEGACY-${p.id}`;
      if (usedBarcodes.has(barcode)) throw new Error(`Colisión de código interno: ${barcode}`);
      usedBarcodes.add(barcode);
      changes.push({
        id: p.id,
        original: p.codigo_barra,
        barcode,
        reason: 'Código vacío o duplicado al quitar espacios',
      });
    }
    const reviews: string[] = [];
    if (p.nombre.trim().length < 2) reviews.push('Nombre incompleto');
    if (p.precio_venta === 0) reviews.push('Sin precio de venta: no disponible en Caja');
    if (p.precio_costo === 0) reviews.push('Sin costo registrado');
    else if (p.precio_venta <= p.precio_costo) reviews.push('Venta menor o igual al costo');
    if (changes.some((c) => c.id === p.id)) reviews.push('Código interno asignado por duplicado');
    return {
      id: legacyId('product', p.id),
      legacy: p,
      barcode,
      name: p.nombre,
      category: categoryAliases[normalized(p.categoria)] || p.categoria.trim() || 'General',
      cost: legacyMoney(p.precio_costo),
      price: legacyMoney(p.precio_venta),
      stock: p.stock,
      minStock: p.stock_minimo,
      trackStock: normalized(p.nombre) !== 'agua caliente',
      sellable: p.precio_venta > 0,
      reviewNote: reviews.length ? reviews.join('. ') : null,
    };
  });
  const total = sales.reduce((sum, s) => sum + legacyMoney(s.total), 0);
  const mixed = sales.filter((s) => s.medio_pago === 'mixto');
  const byDay = new Map<string, { count: number; total: number }>();
  for (const shift of shifts) {
    const day = businessDate(legacyDate(shift.inicio), shift.tipo === 'noche');
    const row = byDay.get(day) || { count: 0, total: 0 };
    row.count += shift.detalle_ventas.length;
    row.total += shift.detalle_ventas.reduce((sum, v) => sum + legacyMoney(v.total), 0);
    byDay.set(day, row);
  }
  const summary = {
    source: LEGACY_SOURCE,
    products: products.length,
    users: users.length,
    shifts: shifts.length,
    sales: sales.length,
    items: sales.reduce((sum, s) => sum + s.items.length, 0),
    totalCents: total,
    rawStock: products.reduce((sum, p) => sum + p.stock, 0),
    trackedStock: plannedProducts.filter((p) => p.trackStock).reduce((sum, p) => sum + p.stock, 0),
    mixedWithoutSplit: mixed.length,
    mixedWithoutSplitCents: mixed.reduce((sum, s) => sum + legacyMoney(s.total), 0),
    unknownHistoricalCosts: sales.length,
    openArchivedShifts: shifts.filter((s) => !s.cerrado).length,
    barcodeChanges: changes,
    reviews: plannedProducts
      .filter((p) => p.reviewNote)
      .map((p) => ({ id: p.legacy.id, name: p.name, note: p.reviewNote })),
    byDay: [...byDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, ...value })),
    missing: [
      'Contraseñas originales',
      'Kardex y auditoría anteriores',
      'Consumos y retiros separados',
      'Costos históricos',
      'Desglose de pagos mixtos',
      'Ventas fuera de los últimos 100 turnos',
    ],
  };
  const sourceData = JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
  const checksum = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return { products: plannedProducts, users, shifts, summary, sourceData, checksum };
}
export type LegacyPlan = ReturnType<typeof planLegacy>;
type Credential = { username: string; password: string; name: string };
export async function importLegacy(
  db: PrismaClient,
  plan: LegacyPlan,
  ownerId: string,
  onCredentials: (credentials: Credential[]) => Promise<void>,
) {
  const prior = await db.importBatch.findUnique({ where: { source: LEGACY_SOURCE } });
  if (prior) {
    if (prior.checksum !== plan.checksum)
      throw new Error('Esta fuente ya fue importada con otro contenido. No se sobrescribe.');
    return { replayed: true, summary: prior.summary };
  }
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  if (!owner || owner.deletedAt || owner.role !== 'OWNER')
    throw new Error('Se requiere un dueño activo para registrar la migración.');
  const credentials: Credential[] = plan.users.map((u) => ({
    username: normalizeUsername(u.username),
    name: u.nombre,
    password: randomBytes(18).toString('base64url'),
  }));
  const users = await Promise.all(
    plan.users.map(async (u, i) => ({
      id: legacyId('user', u.id),
      name: u.nombre,
      username: credentials[i].username,
      passwordHash: await bcrypt.hash(credentials[i].password, 12),
      role: ({ dueño: 'OWNER', admin: 'ADMIN', vendedor: 'SELLER' } as const)[u.rol],
      stockEnabled: u.stock_habilitado,
      mustChangePassword: true,
      deletedAt: u.activo ? null : new Date(),
      createdAt: legacyDate(u.creado_en),
    })),
  );
  const existingUsers = await db.user.count({
    where: { deletedAt: null, username: { in: users.map((u) => u.username) } },
  });
  if (existingUsers)
    throw new Error('Hay nombres de usuario ya en uso; no se modifican cuentas existentes.');
  const existingProducts = await db.product.count({
    where: { barcode: { in: plan.products.map((p) => p.barcode) } },
  });
  if (existingProducts)
    throw new Error('Hay códigos ya en uso; no se sobrescriben productos existentes.');
  const categories = [...new Set(plan.products.map((p) => p.category))];
  const operations: Prisma.OperationCreateManyInput[] = [];
  const items: Prisma.OperationItemCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const productNames = new Map<string, LegacyPlan['products']>();
  for (const p of plan.products) {
    const name = normalized(p.name);
    productNames.set(name, [...(productNames.get(name) || []), p]);
  }
  const shifts = plan.shifts.map((s) => {
    const user = plan.users.find((u) => normalized(u.nombre) === normalized(s.usuario))!;
    const userId = legacyId('user', user.id);
    const id = legacyId('shift', s.id);
    for (const v of s.detalle_ventas) {
      const operationId = legacyId('sale', v.id);
      const subtotal = v.items.reduce((sum, i) => sum + legacyMoney(i.subtotal), 0);
      const total = legacyMoney(v.total);
      operations.push({
        id: operationId,
        userId,
        shiftId: id,
        type: 'SALE',
        historical: true,
        costKnown: false,
        unallocatedPayment: v.medio_pago === 'mixto' ? total : 0,
        subtotal,
        adjustment: total - subtotal,
        total,
        cost: 0,
        createdAt: legacyDate(v.fecha),
        note: `Venta histórica #${v.id}. Costos no incluidos en el archivo.`,
      });
      for (const [index, i] of v.items.entries()) {
        const matches = productNames.get(normalized(i.nombre)) || [];
        items.push({
          id: legacyId('item', `${v.id}:${index}`),
          operationId,
          productId: matches.length === 1 ? matches[0].id : null,
          name: i.nombre,
          quantity: i.cantidad,
          unitPrice: legacyMoney(i.precio_unitario),
          unitCost: 0,
          subtotal: legacyMoney(i.subtotal),
          stockTracked: false,
        });
      }
      if (v.medio_pago !== 'mixto')
        payments.push({
          id: legacyId('payment', v.id),
          operationId,
          method: ({ efectivo: 'CASH', mercadopago: 'MP', tarjeta: 'CARD' } as const)[v.medio_pago],
          amount: total,
        });
    }
    return {
      id,
      userId,
      type: ({ mañana: 'MORNING', tarde: 'AFTERNOON', noche: 'NIGHT' } as const)[s.tipo],
      archived: true,
      businessDate: businessDate(legacyDate(s.inicio), s.tipo === 'noche'),
      openedAt: legacyDate(s.inicio),
      closedAt: s.cierre ? legacyDate(s.cierre) : null,
      openingCash: legacyMoney(s.monto_apertura),
      countedCash: s.monto_cierre === null ? null : legacyMoney(s.monto_cierre),
      expectedCash: null,
      difference: null,
    };
  });
  // Guardar el acceso privado antes del commit; nunca imprimir las contraseñas.
  await onCredentials(credentials);
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(783216450)::text`;
      if (await tx.importBatch.findUnique({ where: { source: LEGACY_SOURCE } }))
        throw new Error('Otra ejecución ya importó esta fuente.');
      await tx.user.createMany({ data: users });
      await tx.category.createMany({
        data: categories.map((name) => ({ name })),
        skipDuplicates: true,
      });
      const categoryRows = await tx.category.findMany({ where: { name: { in: categories } } });
      await tx.product.createMany({
        data: plan.products.map((p) => ({
          id: p.id,
          barcode: p.barcode,
          name: p.name,
          categoryId: categoryRows.find((c) => c.name === p.category)!.id,
          cost: p.cost,
          price: p.price,
          stock: 0,
          minStock: p.minStock,
          trackStock: p.trackStock,
          sellable: p.sellable,
          reviewNote: p.reviewNote,
        })),
      });
      // Saldo inicial y Kardex se insertan en la misma transacción; las ventas antiguas no lo descuentan otra vez.
      const balances = JSON.stringify(plan.products.map((p) => ({ id: p.id, stock: p.stock })));
      await tx.$executeRaw`UPDATE products p SET stock = s.stock FROM jsonb_to_recordset(${balances}::jsonb) AS s(id uuid, stock int) WHERE p.id=s.id AND p.stock=0`;
      await tx.stockMovement.createMany({
        data: plan.products.map((p) => ({
          id: legacyId('opening-stock', p.legacy.id),
          productId: p.id,
          userId: ownerId,
          type: 'COUNT',
          quantity: p.stock,
          before: 0,
          after: p.stock,
          reference: LEGACY_SOURCE,
          note: 'Saldo inicial según copia del 23/10/2026. No incluye el Kardex anterior.',
        })),
      });
      await tx.shift.createMany({ data: shifts });
      for (let i = 0; i < operations.length; i += 500)
        await tx.operation.createMany({ data: operations.slice(i, i + 500) });
      for (let i = 0; i < items.length; i += 1000)
        await tx.operationItem.createMany({ data: items.slice(i, i + 1000) });
      for (let i = 0; i < payments.length; i += 1000)
        await tx.payment.createMany({ data: payments.slice(i, i + 1000) });
      const checks = await verifyLegacy(tx, plan);
      if (!checks.ok)
        throw new Error(
          'Falló la conciliación dentro de la transacción: ' + JSON.stringify(checks),
        );
      await tx.importBatch.create({
        data: {
          source: LEGACY_SOURCE,
          checksum: plan.checksum,
          summary: plan.summary,
          sourceData: plan.sourceData,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: ownerId,
          action: 'LEGACY_IMPORTED',
          detail: {
            source: LEGACY_SOURCE,
            checksum: plan.checksum,
            products: plan.products.length,
            shifts: shifts.length,
            sales: operations.length,
            totalCents: plan.summary.totalCents,
          },
        },
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );
  return { replayed: false, summary: plan.summary };
}
export async function verifyLegacy(db: Prisma.TransactionClient, plan: LegacyPlan) {
  const productRows = await db.product.findMany({
    where: { id: { in: plan.products.map((p) => p.id) } },
    select: {
      id: true,
      stock: true,
      cost: true,
      price: true,
      barcode: true,
      trackStock: true,
      sellable: true,
      name: true,
      minStock: true,
      category: { select: { name: true } },
    },
  });
  const stockMismatch = plan.products
    .filter((p) => {
      const row = productRows.find((v) => v.id === p.id);
      return (
        !row ||
        row.stock !== p.stock ||
        row.cost !== p.cost ||
        row.price !== p.price ||
        row.barcode !== p.barcode ||
        row.trackStock !== p.trackStock ||
        row.sellable !== p.sellable ||
        row.name !== p.name ||
        row.minStock !== p.minStock ||
        row.category.name !== p.category
      );
    })
    .map((p) => p.legacy.id);
  const shiftIds = plan.shifts.map((s) => legacyId('shift', s.id));
  const [shiftRows, ops, itemCount, openingMovements, userCount] = await Promise.all([
    db.shift.findMany({ where: { id: { in: shiftIds }, archived: true } }),
    db.operation.findMany({
      where: { shiftId: { in: shiftIds } },
      include: { payments: true, items: true },
    }),
    db.operationItem.count({ where: { operation: { shiftId: { in: shiftIds } } } }),
    db.stockMovement.count({ where: { reference: LEGACY_SOURCE } }),
    db.user.count({ where: { id: { in: plan.users.map((u) => legacyId('user', u.id)) } } }),
  ]);
  const shiftCount = shiftRows.length;
  const total = ops.reduce((sum, o) => sum + o.total, 0);
  const paid = ops.reduce(
    (sum, o) => sum + o.unallocatedPayment + o.payments.reduce((v, p) => v + p.amount, 0),
    0,
  );
  const shiftMismatch = plan.shifts
    .filter((s) => {
      const rows = ops.filter((o) => o.shiftId === legacyId('shift', s.id));
      const shift = shiftRows.find((v) => v.id === legacyId('shift', s.id));
      return (
        !shift ||
        shift.businessDate !== businessDate(legacyDate(s.inicio), s.tipo === 'noche') ||
        shift.openedAt.getTime() !== legacyDate(s.inicio).getTime() ||
        shift.closedAt?.getTime() !== (s.cierre ? legacyDate(s.cierre).getTime() : undefined) ||
        rows.length !== s.cantidad_ventas ||
        rows.reduce((sum, o) => sum + o.total, 0) !== legacyMoney(s.total_ventas)
      );
    })
    .map((s) => s.id);
  const saleMismatch = plan.shifts
    .flatMap((s) => s.detalle_ventas)
    .filter((s) => {
      const op = ops.find((o) => o.id === legacyId('sale', s.id));
      if (
        !op ||
        !op.historical ||
        op.costKnown ||
        op.createdAt.getTime() !== legacyDate(s.fecha).getTime() ||
        op.total !== legacyMoney(s.total) ||
        op.items.length !== s.items.length ||
        op.unallocatedPayment !== (s.medio_pago === 'mixto' ? op.total : 0)
      )
        return true;
      return s.items.some((item, index) => {
        const row = op.items.find((v) => v.id === legacyId('item', `${s.id}:${index}`));
        return (
          !row ||
          row.name !== item.nombre ||
          row.quantity !== item.cantidad ||
          row.unitPrice !== legacyMoney(item.precio_unitario) ||
          row.subtotal !== legacyMoney(item.subtotal) ||
          row.stockTracked
        );
      });
    })
    .map((s) => s.id);
  const byDay = plan.summary.byDay.map((expected) => {
    const ids = new Set(shiftRows.filter((s) => s.businessDate === expected.day).map((s) => s.id));
    const dayOps = ops.filter((o) => ids.has(o.shiftId));
    return {
      day: expected.day,
      count: dayOps.length,
      total: dayOps.reduce((sum, o) => sum + o.total, 0),
    };
  });
  const dayMismatch = byDay
    .filter(
      (day, index) =>
        day.total !== plan.summary.byDay[index].total ||
        day.count !== plan.summary.byDay[index].count,
    )
    .map((day) => day.day);
  const ok =
    !stockMismatch.length &&
    !shiftMismatch.length &&
    !saleMismatch.length &&
    !dayMismatch.length &&
    productRows.length === plan.summary.products &&
    shiftCount === plan.summary.shifts &&
    ops.length === plan.summary.sales &&
    itemCount === plan.summary.items &&
    total === plan.summary.totalCents &&
    paid === total &&
    openingMovements === plan.summary.products &&
    userCount === plan.summary.users;
  return {
    ok,
    products: productRows.length,
    users: userCount,
    shifts: shiftCount,
    sales: ops.length,
    items: itemCount,
    totalCents: total,
    paymentCents: paid,
    rawStock: productRows.reduce((sum, p) => sum + p.stock, 0),
    stockMismatch,
    shiftMismatch,
    saleMismatch,
    dayMismatch,
    byDay,
    openingMovements,
  };
}
