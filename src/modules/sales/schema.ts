import { z } from 'zod';
import { cents } from '@/modules/stock/service';
const item = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('product'),
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('quick'),
      quickId: z.uuid(),
      quantity: z.number().int().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('custom'),
      name: z.string().trim().min(2).max(100),
      price: cents.refine((v) => v > 0),
      quantity: z.number().int().min(1).max(10000),
    })
    .strict(),
]);
export const cartSchema = z
  .object({
    type: z.enum(['SALE', 'EMPLOYEE', 'OWNER']),
    items: z.array(item).min(1).max(100),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export const paymentSchema = z
  .object({ method: z.enum(['CASH', 'CARD', 'MP']), amount: cents })
  .strict();
export const checkoutSchema = cartSchema
  .extend({
    shiftId: z.uuid(),
    idempotencyKey: z.uuid(),
    quoteToken: z.string().max(20000).optional(),
    offlineToken: z.string().max(20000).optional(),
    expectedTotal: cents.optional(),
    payments: z.array(paymentSchema).max(2),
    received: cents.optional(),
    offline: z.boolean().optional(),
  })
  .strict();
export type CartInput = z.infer<typeof cartSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
