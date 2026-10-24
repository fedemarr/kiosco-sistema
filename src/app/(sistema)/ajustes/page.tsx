import { redirect } from 'next/navigation';
import { requireSession } from '@/modules/auth/session';
import { can } from '@/modules/auth/permissions';
import { SettingsScreen } from '@/modules/settings/settings-screen';
export default async function Ajustes() {
  if (!can(await requireSession(), 'owner')) redirect('/caja');
  return <SettingsScreen />;
}
