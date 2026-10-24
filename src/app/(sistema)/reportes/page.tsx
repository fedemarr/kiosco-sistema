import { redirect } from 'next/navigation';
import { requireSession } from '@/modules/auth/session';
import { can } from '@/modules/auth/permissions';
import { ReportScreen } from '@/modules/reports/report-screen';
export default async function Reportes() {
  if (!can(await requireSession(), 'owner')) redirect('/caja');
  return <ReportScreen />;
}
