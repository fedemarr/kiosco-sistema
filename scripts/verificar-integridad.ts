import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyIntegrity } from '../src/modules/stock/integrity';
if (process.argv.includes('--test')) {
  const value = process.env.TEST_DATABASE_URL;
  if (!value || !new URL(value).pathname.endsWith('_test'))
    throw new Error('Falta una base exclusiva de pruebas.');
  process.env.DATABASE_URL = value;
} else process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
const { db } = await import('../src/lib/db');
try {
  const result = await verifyIntegrity(db);
  const folder = resolve('data/auditoria');
  await mkdir(folder, { recursive: true });
  const file = join(folder, `integridad-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
  console.info(JSON.stringify({ ...result, file }, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
