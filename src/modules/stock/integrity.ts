import type { PrismaClient } from '@/generated/prisma/client';
export async function verifyIntegrity(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      const stockErrors = await tx.$queryRaw<
        { id: string; name: string; stock: number; ledger: number }[]
      >`SELECT p.id,p.name,p.stock,COALESCE(sum(m.quantity),0)::int AS ledger FROM products p LEFT JOIN stock_movements m ON m.product_id=p.id GROUP BY p.id HAVING p.stock<>COALESCE(sum(m.quantity),0)`;
      const paymentErrors = await tx.$queryRaw<
        { id: string; total: number; paid: number }[]
      >`SELECT o.id,o.total,(COALESCE(sum(p.amount),0)+o.unallocated_payment)::int AS paid FROM operations o LEFT JOIN payments p ON p.operation_id=o.id WHERE o.type<>'OWNER' GROUP BY o.id HAVING o.total<>COALESCE(sum(p.amount),0)+o.unallocated_payment`;
      const itemErrors = await tx.$queryRaw<
        { id: string }[]
      >`SELECT o.id FROM operations o LEFT JOIN operation_items i ON i.operation_id=o.id GROUP BY o.id HAVING o.subtotal<>COALESCE(sum(i.subtotal),0) OR (o.cost_known AND o.cost<>COALESCE(sum(i.unit_cost::bigint*i.quantity),0)) OR (o.type='OWNER' AND o.total<>o.cost) OR (o.type<>'OWNER' AND o.total<>o.subtotal+o.adjustment)`;
      const movementErrors = await tx.$queryRaw<
        { id: string; product_id: string }[]
      >`SELECT o.id,i.product_id FROM operations o JOIN operation_items i ON i.operation_id=o.id WHERE NOT o.historical AND i.stock_tracked AND i.product_id IS NOT NULL GROUP BY o.id,i.product_id HAVING -sum(i.quantity)<>COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.reference=o.id::text AND m.product_id=i.product_id AND m.type::text=o.type::text),0)`;
      const missingKeys = await tx.$queryRaw<
        { id: string }[]
      >`SELECT o.id FROM operations o LEFT JOIN idempotency k ON k.operation_id=o.id WHERE NOT o.historical AND k.key IS NULL`;
      const [products, operations, movements] = await Promise.all([
        tx.product.count(),
        tx.operation.count(),
        tx.stockMovement.count(),
      ]);
      return {
        ok:
          !stockErrors.length &&
          !paymentErrors.length &&
          !itemErrors.length &&
          !movementErrors.length &&
          !missingKeys.length,
        checkedAt: new Date().toISOString(),
        products,
        operations,
        movements,
        stockErrors,
        paymentErrors,
        itemErrors,
        movementErrors,
        missingKeys,
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 60000 },
  );
}
