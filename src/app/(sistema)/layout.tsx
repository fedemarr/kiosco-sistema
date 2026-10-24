import { redirect } from 'next/navigation';
import { getSession } from '@/modules/auth/session';
import { AppShell } from '@/components/app-shell';
export const dynamic = 'force-dynamic';
export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/cambiar-clave');
  return <AppShell user={user}>{children}</AppShell>;
}
