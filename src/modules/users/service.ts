import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { transaction } from '@/lib/transaction';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { normalizeUsername } from '@/lib/format';
export const passwordSchema = z
  .string()
  .min(10, 'Usá al menos 10 caracteres')
  .max(72, 'Máximo 72 caracteres')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'Máximo 72 bytes');
const fields = z.object({
  name: z.string().trim().min(2).max(100),
  username: z
    .string()
    .transform(normalizeUsername)
    .pipe(
      z
        .string()
        .min(2)
        .max(50)
        .regex(/^[a-z0-9._-]+$/, 'Usá letras sin acentos, números, punto o guion'),
    ),
  role: z.enum(['OWNER', 'ADMIN', 'SELLER']),
  stockEnabled: z.boolean(),
});
export async function createUser(actorId: string, body: unknown) {
  const input = fields.extend({ password: passwordSchema }).strict().parse(body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  return transaction(async (tx) => {
    if (await tx.user.findFirst({ where: { username: input.username, deletedAt: null } }))
      throw new AppError('Ese usuario ya existe.', 409);
    const { password: _password, ...data } = input;
    void _password;
    const user = await tx.user.create({
      data: { ...data, passwordHash, mustChangePassword: true },
      select: { id: true, name: true, username: true, role: true, stockEnabled: true },
    });
    await audit(tx, actorId, 'USER_CREATED', {
      userId: user.id,
      username: user.username,
      role: user.role,
    });
    return user;
  });
}
export async function updateUser(actorId: string, id: string, body: unknown) {
  const input = z
    .object({
      stockEnabled: z.boolean().optional(),
      active: z.boolean().optional(),
      role: z.enum(['OWNER', 'ADMIN', 'SELLER']).optional(),
    })
    .strict()
    .parse(body);
  if (
    id === actorId &&
    (input.active === false || (input.role && input.role !== 'OWNER' && input.role !== 'ADMIN'))
  )
    throw new AppError('No podés quitarte tu propio acceso de administración.');
  return transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new AppError('Usuario no encontrado.', 404);
    if (
      input.active === true &&
      (await tx.user.findFirst({
        where: { username: current.username, deletedAt: null, id: { not: id } },
      }))
    )
      throw new AppError('El nombre de usuario ya está en uso.', 409);
    const result = await tx.user.update({
      where: { id },
      data: {
        stockEnabled: input.stockEnabled,
        role: input.role,
        ...(input.active !== undefined ? { deletedAt: input.active ? null : new Date() } : {}),
      },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        stockEnabled: true,
        deletedAt: true,
      },
    });
    if (input.active === false) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, actorId, 'USER_UPDATED', { userId: id, ...input });
    return result;
  });
}
export const listUsers = () =>
  db.user.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      stockEnabled: true,
      deletedAt: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
    take: 200,
  });
