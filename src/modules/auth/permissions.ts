import type { Role } from '@/generated/prisma/enums';
import { AppError } from '@/lib/errors';
export type Actor = {
  id: string;
  name: string;
  username: string;
  role: Role;
  stockEnabled: boolean;
  mustChangePassword: boolean;
};
export type Permission = 'sell' | 'stock' | 'owner';
export function can(user: Pick<Actor, 'role' | 'stockEnabled'>, permission: Permission) {
  return (
    permission === 'sell' ||
    user.role === 'OWNER' ||
    user.role === 'ADMIN' ||
    (permission === 'stock' && user.stockEnabled)
  );
}
export function requirePermission(user: Actor, permission: Permission) {
  if (!can(user, permission))
    throw new AppError('No tenés permiso para realizar esta acción.', 403, 'FORBIDDEN');
}
