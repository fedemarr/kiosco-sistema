import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { transaction } from '@/lib/transaction';
import { Prisma } from '@/generated/prisma/client';
import { requirePermission, type Actor } from '@/modules/auth/permissions';
import { moveStock } from '@/modules/stock/service';
import { calculateTotals, validatePayments } from './pricing';
import { cartSchema, checkoutSchema, type CartInput } from './schema';
import { verifyOfflinePermit } from '@/modules/offline/permit';
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
function quoteSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new AppError('Falta configurar la clave de sesión.', 503);
  return new TextEncoder().encode(s);
}
export async function priceCart(tx: Prisma.TransactionClient, input: CartInput, date = new Date()) {
  const items = [];
  const grouped = new Map<string, number>();
  for (const item of input.items) {
    if (item.kind === 'product') {
      const p = await tx.product.findUnique({ where: { id: item.productId } });
      if (!p || p.deletedAt)
        throw new AppError(
          'Un producto del carrito ya no está disponible.',
          409,
          'PRODUCT_UNAVAILABLE',
        );
      grouped.set(p.id, (grouped.get(p.id) || 0) + item.quantity);
      if (p.trackStock && p.stock < grouped.get(p.id)!)
        throw new AppError(`No hay stock suficiente de ${p.name}.`, 409, 'INSUFFICIENT_STOCK');
      items.push({
        productId: p.id,
        name: p.name,
        quantity: item.quantity,
        unitPrice: p.price,
        unitCost: p.cost,
        subtotal: p.price * item.quantity,
        stockTracked: p.trackStock,
      });
    } else {
      if (input.type === 'OWNER')
        throw new AppError('El retiro requiere productos con costo registrado.');
      const quick =
        item.kind === 'quick'
          ? await tx.quickButton.findUnique({ where: { id: item.quickId } })
          : null;
      if (item.kind === 'quick' && (!quick || !quick.active))
        throw new AppError('Ese botón rápido ya no está disponible.');
      const name = item.kind === 'custom' ? item.name : quick!.name;
      const unitPrice = item.kind === 'custom' ? item.price : quick!.price;
      items.push({
        productId: null,
        name,
        quantity: item.quantity,
        unitPrice,
        unitCost: 0,
        subtotal: unitPrice * item.quantity,
        stockTracked: false,
      });
    }
  }
  const totals = calculateTotals(
    items.reduce((s, i) => s + i.subtotal, 0),
    items.reduce((s, i) => s + i.unitCost * i.quantity, 0),
    input.type,
    date,
  );
  return { ...totals, items };
}
export async function quote(user: Actor, body: unknown) {
  const input = cartSchema.parse(body);
  if (input.type === 'OWNER') requirePermission(user, 'owner');
  const priced = await priceCart(db, input);
  const quoteToken = await new SignJWT({
    userId: user.id,
    cartHash: hash(input),
    priceHash: hash(priced),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(quoteSecret());
  return { ...priced, quoteToken, quotedAt: new Date().toISOString() };
}
export async function checkout(user: Actor, body: unknown) {
  const input = checkoutSchema.parse(body);
  const cart: CartInput = {
    type: input.type,
    items: input.items,
    ...(input.note ? { note: input.note } : {}),
  };
  const requestHash = hash(input);
  const replay = async () => {
    const old = await db.idempotency.findUnique({
      where: { key: input.idempotencyKey },
      include: { operation: { include: { payments: true, items: true } } },
    });
    if (!old) return null;
    if (old.userId !== user.id || old.requestHash !== requestHash)
      throw new AppError('Esta clave ya se usó para otro cobro.', 409, 'IDEMPOTENCY_CONFLICT');
    return { ...old.operation, replayed: true };
  };
  const old = await replay();
  if (old) return old;
  if (input.type === 'OWNER') {
    requirePermission(user, 'owner');
    if (!input.note) throw new AppError('Indicá el motivo del retiro.');
  }
  try {
    let priceHash: unknown;
    if (input.offline) {
      await verifyOfflinePermit(input.offlineToken, user.id, input.shiftId);
      if (input.expectedTotal === undefined)
        throw new AppError('Falta el total cobrado sin conexión.');
    } else {
      if (!input.quoteToken) throw new Error('quote');
      const { payload } = await jwtVerify(input.quoteToken, quoteSecret(), {
        algorithms: ['HS256'],
      });
      if (payload.userId !== user.id || payload.cartHash !== hash(cart)) throw new Error('quote');
      priceHash = payload.priceHash;
    }
    return await transaction(async (tx) => {
      // Bloquear el turno serializa cobro/cierre y evita registrar ventas después del cierre.
      await tx.$queryRaw`SELECT id FROM shifts WHERE user_id = ${user.id}::uuid AND closed_at IS NULL FOR UPDATE`;
      const shift = await tx.shift.findFirst({ where: { userId: user.id, closedAt: null } });
      if (!shift || shift.id !== input.shiftId)
        throw new AppError(
          'El turno de esta venta ya no está abierto. Si era una venta pendiente, el dueño debe revisarla.',
          409,
          'NO_OPEN_SHIFT',
        );
      const priced = await priceCart(tx, cart);
      if (input.offline ? input.expectedTotal !== priced.total : priceHash !== hash(priced))
        throw new AppError(
          'El total cambió. Confirmá cuánto cobrar o devolver antes de continuar.',
          409,
          'QUOTE_CHANGED',
          { quote: await quote(user, cart) },
        );
      validatePayments(priced.total, input.type, input.payments, input.received);
      const operation = await tx.operation.create({
        data: {
          userId: user.id,
          shiftId: shift.id,
          type: input.type,
          subtotal: priced.subtotal,
          adjustment: priced.adjustment,
          total: priced.total,
          cost: priced.cost,
          note: input.note,
          items: { create: priced.items },
          payments: { create: input.payments },
        },
        include: { items: true, payments: true },
      });
      // Orden consistente para evitar deadlocks entre carritos en dos cajas.
      for (const item of [...priced.items].sort((a, b) =>
        (a.productId || '').localeCompare(b.productId || ''),
      )) {
        if (item.productId && item.stockTracked)
          await moveStock(tx, {
            productId: item.productId,
            userId: user.id,
            type: input.type,
            delta: -item.quantity,
            reference: operation.id,
          });
      }
      await tx.idempotency.create({
        data: {
          key: input.idempotencyKey,
          userId: user.id,
          requestHash,
          operationId: operation.id,
        },
      });
      await audit(tx, user.id, input.type, {
        operationId: operation.id,
        total: operation.total,
        offline: input.offline || false,
      });
      return operation;
    });
  } catch (error) {
    // Otra petición con la misma clave puede haber ganado la transacción.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await replay();
      if (saved) return saved;
    }
    if (error instanceof AppError || error instanceof Prisma.PrismaClientKnownRequestError)
      throw error;
    if (
      error instanceof Error &&
      (error.name.startsWith('JWT') || error.name.startsWith('JWS') || error.message === 'quote')
    )
      throw new AppError(
        'La cotización venció o no corresponde al carrito. Volvé a cotizar.',
        409,
        'QUOTE_EXPIRED',
      );
    throw error;
  }
}
export async function voidOperation(user: Actor, id: string, reason: string) {
  requirePermission(user, 'owner');
  return transaction(async (tx) => {
    const operation = await tx.operation.findUnique({
      where: { id },
      include: { items: true, shift: true },
    });
    if (!operation) throw new AppError('Operación no encontrada.', 404);
    if (operation.voidedAt) return operation;
    await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${operation.shiftId}::uuid FOR UPDATE`;
    const changed = await tx.operation.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    if (!changed.count) return operation;
    for (const item of operation.items) {
      if (item.productId && item.stockTracked) {
        let restoreId = item.productId;
        for (let depth = 0; depth < 100; depth++) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: restoreId },
            select: { mergedIntoId: true },
          });
          if (!product.mergedIntoId) break;
          restoreId = product.mergedIntoId;
          if (depth === 99) throw new AppError('La cadena de fusiones requiere revisión.', 409);
        }
        // Conservar devoluciones incluso si el producto fue desactivado posteriormente.
        const rows = await tx.$queryRaw<
          { stock: number }[]
        >`UPDATE products SET stock = stock + ${item.quantity}, updated_at = now() WHERE id = ${restoreId}::uuid RETURNING stock`;
        await tx.stockMovement.create({
          data: {
            productId: restoreId,
            userId: user.id,
            type: 'VOID',
            quantity: item.quantity,
            before: rows[0].stock - item.quantity,
            after: rows[0].stock,
            reference: id,
            note: reason,
          },
        });
      }
    }
    await audit(tx, user.id, 'OPERATION_VOIDED', { operationId: id, reason });
    return { voided: true };
  });
}
