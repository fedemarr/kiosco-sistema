import { api } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { importWorkbook } from '@/modules/stock/excel';
export const runtime = 'nodejs';
const importHandler = api('owner', async (request, user) => {
  if (Number(request.headers.get('content-length')) > 2_000_000)
    throw new AppError('El archivo supera el máximo de 2 MB.');
  const data = await request.formData();
  const file = data.get('file');
  if (!(file instanceof File) || file.size > 2_000_000 || !file.name.endsWith('.xlsx'))
    throw new AppError('Elegí un archivo .xlsx de hasta 2 MB.');
  return importWorkbook(user.id, await file.arrayBuffer());
});
export async function POST(request: Request) {
  return importHandler(request);
}
