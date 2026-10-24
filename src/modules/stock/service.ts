import { z } from 'zod';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { transaction } from '@/lib/transaction';
import { audit } from '@/lib/audit';
import type { Prisma, MovementType } from '@/generated/prisma/client';
export const cents = z.number().int().min(0).max(100_000_000);
export const productSchema = z
  .object({
    barcode: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(2).max(150),
    categoryId: z.uuid(),
    cost: cents,
    price: cents.refine((v) => v > 0, 'Ingresá un precio mayor a cero'),
    minStock: z.number().int().min(0).max(1000000),
    trackStock: z.boolean(),
  })
  .strict();
export const movementSchema = z
  .object({
    type: z.enum(['RECEIPT', 'COUNT']),
    quantity: z.number().int().min(0).max(1000000),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export async function moveStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    userId: string;
    type: MovementType;
    delta: number;
    reference?: string;
    note?: string;
  },
) {
  const rows = await tx.$queryRaw<
    { stock: number }[]
  >`UPDATE products SET stock = stock + ${input.delta}, updated_at = now() WHERE id = ${input.productId}::uuid AND deleted_at IS NULL AND track_stock = true AND stock + ${input.delta} >= 0 RETURNING stock`;
  if (!rows.length)
    throw new AppError(
      'Stock insuficiente o producto no disponible. Actualizá el carrito.',
      409,
      'INSUFFICIENT_STOCK',
    );
  const after = rows[0].stock;
  const { delta, ...data } = input;
  return tx.stockMovement.create({
    data: { ...data, quantity: delta, before: after - delta, after },
  });
}
export async function listProducts(url: URL, includeStock = false) {
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(!includeStock ? { sellable: true } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(url.searchParams.get('category')
      ? { categoryId: z.uuid().parse(url.searchParams.get('category')) }
      : {}),
  };
  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * 60,
      take: 60,
      include: { category: true },
    }),
    db.product.count({ where }),
  ]);
  return {
    products: includeStock
      ? products
      : products.map(({ cost: _cost, ...product }) => {
          void _cost;
          return product;
        }),
    total,
    page,
  };
}
export async function saveProduct(userId: string, body: unknown, id?: string) {
  const input = productSchema.parse(body);
  return transaction(async (tx) => {
    if (id) {
      const current = await tx.product.findUnique({ where: { id } });
      if (!current || current.deletedAt) throw new AppError('No encontramos el producto.', 404);
    }
    const barcode = input.barcode || `SIN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const old = !id ? await tx.product.findUnique({ where: { barcode } }) : null;
    if (old?.mergedIntoId)
      throw new AppError(
        'Ese código pertenece a un producto fusionado. Usá el producto destino o un código nuevo.',
        409,
        'MERGED_PRODUCT',
      );
    if (old && !old.deletedAt) throw new AppError('Ese código ya está en uso.', 409, 'CONFLICT');
    const data = { ...input, barcode, deletedAt: null, sellable: true, reviewNote: null };
    const product = id
      ? await tx.product.update({
          where: { id },
          data: {
            ...input,
            sellable: true,
            reviewNote: null,
            ...(input.barcode ? { barcode: input.barcode } : {}),
          },
        })
      : old
        ? await tx.product.update({ where: { id: old.id }, data })
        : await tx.product.create({ data });
    await audit(
      tx,
      userId,
      id ? 'PRODUCT_UPDATED' : old ? 'PRODUCT_REACTIVATED' : 'PRODUCT_CREATED',
      { productId: product.id, ...input },
    );
    return product;
  });
}
export async function adjustStock(userId: string, productId: string, body: unknown) {
  const input = movementSchema.parse(body);
  return transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.deletedAt) throw new AppError('Producto no encontrado.', 404);
    if (!product.trackStock) throw new AppError('Este producto no controla stock.');
    const delta = input.type === 'RECEIPT' ? input.quantity : input.quantity - product.stock;
    if (input.type === 'RECEIPT' && delta <= 0)
      throw new AppError('La cantidad a cargar debe ser mayor a cero.');
    if (delta < 0 && !input.note)
      throw new AppError('Para bajar el stock necesitás indicar un motivo.');
    const movement = await moveStock(tx, {
      productId,
      userId,
      type: input.type,
      delta,
      note: input.note,
    });
    await audit(tx, userId, 'STOCK_ADJUSTED', { productId, ...input, delta });
    return movement;
  });
}
export async function mergeProducts(userId: string, targetId: string, sourceId: string) {
  if (targetId === sourceId) throw new AppError('Elegí dos productos diferentes.');
  return transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: [targetId, sourceId] }, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    if (products.length !== 2) throw new AppError('No encontramos ambos productos.', 404);
    const source = products.find((p) => p.id === sourceId)!;
    const target = products.find((p) => p.id === targetId)!;
    if (!source.trackStock || !target.trackStock)
      throw new AppError('La fusión requiere dos productos con control de stock.');
    await moveStock(tx, {
      productId: sourceId,
      userId,
      type: 'MERGE',
      delta: -source.stock,
      reference: targetId,
      note: 'Fusión de duplicados: origen',
    });
    await moveStock(tx, {
      productId: targetId,
      userId,
      type: 'MERGE',
      delta: source.stock,
      reference: sourceId,
      note: 'Fusión de duplicados: destino',
    });
    await tx.product.update({
      where: { id: sourceId },
      data: { deletedAt: new Date(), mergedIntoId: targetId },
    });
    await audit(tx, userId, 'PRODUCTS_MERGED', { sourceId, targetId, stock: source.stock });
    return { merged: true };
  });
}
