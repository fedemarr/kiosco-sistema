import { db } from './db';
import { Prisma } from '@/generated/prisma/client';
import { AppError } from './errors';
export async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: 'Serializable',
        timeout: 15000,
        maxWait: 10000,
      });
    } catch (error) {
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            (error.meta?.code === '40001' || error.meta?.code === '40P01')));
      if (!retry) throw error;
      if (attempt === 3)
        throw new AppError(
          'Otra caja modificó estos datos. Volvé a intentar.',
          409,
          'CONCURRENT_CHANGE',
        );
    }
  }
  throw new AppError('No se pudo guardar.', 409);
}
