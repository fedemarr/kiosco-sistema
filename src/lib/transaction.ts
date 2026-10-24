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
      const adapterCause =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? (
              error.meta?.driverAdapterError as
                { cause?: { originalCode?: string; kind?: string } } | undefined
            )?.cause
          : undefined;
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            (error.meta?.code === '40001' ||
              error.meta?.code === '40P01' ||
              adapterCause?.originalCode === '40001' ||
              adapterCause?.originalCode === '40P01' ||
              adapterCause?.kind === 'TransactionWriteConflict')));
      if (!retry) throw error;
      if (attempt === 3)
        throw new AppError(
          'Otra caja modificó estos datos. Volvé a intentar.',
          409,
          'CONCURRENT_CHANGE',
        );
      await new Promise((resolve) =>
        setTimeout(resolve, 10 * 2 ** attempt + Math.floor(Math.random() * 15)),
      );
    }
  }
  throw new AppError('No se pudo guardar.', 409);
}
