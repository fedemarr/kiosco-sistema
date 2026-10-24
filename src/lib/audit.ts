import type { Prisma } from '@/generated/prisma/client';
export async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  detail: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({ data: { userId, action, detail } });
}
