import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@/lib/errors';
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new AppError('Falta configurar SESSION_SECRET.', 503);
  return new TextEncoder().encode(value);
}
export async function offlinePermit(userId: string, shiftId: string) {
  return new SignJWT({ scope: 'offline-sale', userId, shiftId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}
export async function verifyOfflinePermit(
  token: string | undefined,
  userId: string,
  shiftId: string,
) {
  try {
    if (!token) throw new Error('missing');
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (
      payload.scope !== 'offline-sale' ||
      payload.userId !== userId ||
      payload.shiftId !== shiftId
    )
      throw new Error('invalid');
  } catch {
    throw new AppError(
      'La autorización offline no corresponde a esta sesión o venció. Pedile al dueño que revise el cobro.',
      409,
      'OFFLINE_PERMIT',
    );
  }
}
