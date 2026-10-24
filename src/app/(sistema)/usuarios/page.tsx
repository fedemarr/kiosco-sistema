import { redirect } from 'next/navigation';
import { requireSession } from '@/modules/auth/session';
import { can } from '@/modules/auth/permissions';
import { UsersScreen } from '@/modules/users/users-screen';
export default async function Usuarios() {
  if (!can(await requireSession(), 'owner')) redirect('/caja');
  return <UsersScreen />;
}
