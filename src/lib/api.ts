import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { AppError } from './errors';
import { requireSession } from '@/modules/auth/session';
import { requirePermission, type Actor, type Permission } from '@/modules/auth/permissions';
export function success(data: unknown, status = 200) {
  return NextResponse.json(
    { success: true, data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function api(
  permission: Permission,
  handler: (request: Request, user: Actor, parts: string[]) => Promise<unknown>,
) {
  return async (request: Request, parts: string[] = []) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) checkOrigin(request);
      const user = await requireSession();
      if (user.mustChangePassword && !['auth/password', 'auth/logout'].includes(parts.join('/')))
        throw new AppError('Cambiá tu contraseña para continuar.', 403, 'PASSWORD_CHANGE_REQUIRED');
      requirePermission(user, permission);
      await rateLimit(`user:${user.id}`, 300, 60);
      return success(await handler(request, user, parts));
    } catch (error) {
      return failure(error);
    }
  };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (!origin || origin !== expected)
    throw new AppError('Origen de la solicitud no permitido.', 403, 'ORIGIN');
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    return failure(
      new AppError(
        'Ya existe un registro con estos datos. Actualizá y reintentá.',
        409,
        'CONFLICT',
      ),
    );
  if (error instanceof SyntaxError)
    return failure(new AppError('El formato enviado no es válido.'));
  console.error(
    JSON.stringify({ event: 'api_error', type: error instanceof Error ? error.name : 'Unknown' }),
  );
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL',
        message: 'No pudimos completar la operación. Revisá el estado antes de reintentar.',
      },
    },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function rateLimit(key: string, max: number, seconds: number) {
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO rate_limits (key, count, expires_at) VALUES (${key}, 1, now() + ${seconds} * interval '1 second') ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.count + 1 END, expires_at = CASE WHEN rate_limits.expires_at < now() THEN now() + ${seconds} * interval '1 second' ELSE rate_limits.expires_at END RETURNING count`;
  if (rows[0].count > max)
    throw new AppError('Demasiados intentos. Esperá un minuto.', 429, 'RATE_LIMIT');
}
