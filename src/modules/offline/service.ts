import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { checkoutSchema } from '@/modules/sales/schema';
import { checkout } from '@/modules/sales/service';
import type { Actor } from '@/modules/auth/permissions';
export async function syncCheckout(user: Actor, body: unknown) {
  const input = checkoutSchema.parse(body);
  try {
    const result = await checkout(user, input);
    await db.offlineConflict.updateMany({
      where: { key: input.idempotencyKey, userId: user.id },
      data: { resolved: true, resolution: 'Cobro sincronizado y confirmado por el servidor.' },
    });
    return result;
  } catch (error) {
    if (error instanceof AppError && error.status === 409) {
      const existing = await db.offlineConflict.findUnique({
        where: { key: input.idempotencyKey },
      });
      if (!existing || existing.userId === user.id) {
        const payload = JSON.parse(JSON.stringify(input));
        await db.offlineConflict.upsert({
          where: { key: input.idempotencyKey },
          create: {
            key: input.idempotencyKey,
            userId: user.id,
            payload,
            code: error.code,
            message: error.message,
          },
          update: { payload, code: error.code, message: error.message },
        });
      }
    }
    throw error;
  }
}
