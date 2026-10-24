import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { checkOrigin, failure, rateLimit, success } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { normalizeUsername } from '@/lib/format';
import { createSession } from '@/modules/auth/session';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z
      .object({
        username: z.string().max(100).transform(normalizeUsername),
        password: z.string().min(1).max(100),
      })
      .strict()
      .parse(await request.json());
    // Vercel establece x-vercel-forwarded-for; no confiar en una cabecera arbitraria para identidad.
    const ip = request.headers.get('x-vercel-forwarded-for') || 'local';
    await rateLimit(`login-ip:${createHash('sha256').update(ip).digest('hex')}`, 60, 60);
    await rateLimit(`login-user:${input.username}`, 8, 60);
    const user =
      (await db.user.findFirst({ where: { username: input.username, deletedAt: null } })) ||
      (await db.user.findFirst({
        where: { username: input.username },
        orderBy: { createdAt: 'desc' },
      }));
    // Ejecutar bcrypt también cuando no existe usuario para evitar diferencias evidentes de tiempo.
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
    );
    if (!user || !valid)
      throw new AppError('Usuario o contraseña incorrectos.', 401, 'INVALID_CREDENTIALS');
    if (user.deletedAt)
      throw new AppError(
        'Este usuario está desactivado. Pedile al dueño que lo habilite.',
        403,
        'USER_DISABLED',
      );
    await createSession(user.id);
    return success({ name: user.name, mustChangePassword: user.mustChangePassword });
  } catch (error) {
    return failure(error);
  }
}
