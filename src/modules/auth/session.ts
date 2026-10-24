import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Actor } from './permissions';
export const COOKIE = 'kiosco_session';
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new AppError(
      'Falta configurar SESSION_SECRET (mínimo 32 caracteres).',
      503,
      'CONFIGURATION',
    );
  return new TextEncoder().encode(value);
}
export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const session = await db.session.create({ data: { userId, expiresAt } });
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}
export async function getSession(): Promise<Actor | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sid: string;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string') return null;
    sid = payload.sid;
  } catch {
    return null;
  }
  const session = await db.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.deletedAt) return null;
  const { id, name, username, role, stockEnabled, mustChangePassword } = session.user;
  return { id, name, username, role, stockEnabled, mustChangePassword };
}
export async function requireSession() {
  const user = await getSession();
  if (!user) throw new AppError('Ingresá con tu usuario para continuar.', 401, 'UNAUTHORIZED');
  return user;
}
export async function destroySession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
      if (typeof payload.sid === 'string')
        await db.session.deleteMany({ where: { id: payload.sid } });
    } catch {
      /* cookie inválida: eliminar de todas formas */
    }
  }
  (await cookies()).delete(COOKIE);
}
