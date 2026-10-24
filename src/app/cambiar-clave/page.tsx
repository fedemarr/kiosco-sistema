import { redirect } from 'next/navigation';
import { getSession } from '@/modules/auth/session';
import { Account } from '@/components/account';
export default async function CambiarClave() {
  if (!(await getSession())) redirect('/login');
  return (
    <div className="login">
      <Account required />
    </div>
  );
}
