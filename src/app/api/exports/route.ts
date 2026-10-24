import { requireSession } from '@/modules/auth/session';
import { requirePermission } from '@/modules/auth/permissions';
import { failure, rateLimit } from '@/lib/api';
import { exportWorkbook } from '@/modules/stock/excel';
import { AppError } from '@/lib/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireSession();
    if (user.mustChangePassword)
      throw new AppError('Cambiá tu contraseña para continuar.', 403, 'PASSWORD_CHANGE_REQUIRED');
    requirePermission(user, 'owner');
    await rateLimit(`export:${user.id}`, 10, 60);
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') || 'products';
    const buffer = await exportWorkbook(kind, url);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="kiosco-${kind}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
