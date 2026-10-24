import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {
  planLegacy,
  importLegacy,
  verifyLegacy,
  LEGACY_SOURCE,
} from '../src/modules/imports/legacy';

const args = process.argv.slice(2);
const rehearsal = args.includes('--rehearsal');
const apply = args.includes('--apply') || rehearsal;
const verify = args.includes('--verify');
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1] || fallback;
};
const sourceDir = resolve(option('--source-dir', '.'));
const input = {
  products: JSON.parse(await readFile(join(sourceDir, 'productos.json'), 'utf8')),
  users: JSON.parse(await readFile(join(sourceDir, 'usuarios.json'), 'utf8')),
  shifts: JSON.parse(await readFile(join(sourceDir, 'turnos_ultimos_100.json'), 'utf8')),
};
const plan = planLegacy(input);
const folder = resolve('data/migracion');
await mkdir(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = join(folder, `informe-${stamp}.json`);
await writeFile(reportPath, JSON.stringify(plan.summary, null, 2), { mode: 0o600, flag: 'wx' });
console.info(
  JSON.stringify(
    {
      mode: rehearsal
        ? 'ensayo local'
        : apply
          ? 'importación'
          : verify
            ? 'verificación'
            : 'simulación sin escrituras',
      products: plan.summary.products,
      users: plan.summary.users,
      shifts: plan.summary.shifts,
      sales: plan.summary.sales,
      items: plan.summary.items,
      totalCents: plan.summary.totalCents,
      trackedStock: plan.summary.trackedStock,
      mixedWithoutSplit: plan.summary.mixedWithoutSplit,
      reviewProducts: plan.summary.reviews.length,
      report: reportPath,
    },
    null,
    2,
  ),
);
if (!apply && !verify) process.exit(0);
if (rehearsal) {
  const url = new URL(
    process.env.TEST_DATABASE_URL ||
      'postgresql://kiosco:local_only_change_me@localhost:54329/kiosco_test',
  );
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('El ensayo requiere PostgreSQL local.');
  url.pathname = '/postgres';
  const pool = new pg.Pool({ connectionString: url.toString() });
  if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='kiosco_import_test'")).rowCount)
    await pool.query("CREATE DATABASE kiosco_import_test ENCODING 'UTF8' TEMPLATE template0");
  await pool.end();
  url.pathname = '/kiosco_import_test';
  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_URL = url.toString();
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
} else process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
const { db } = await import('../src/lib/db');
try {
  const username = option('--owner', rehearsal ? 'import-rehearsal' : 'adminjuan');
  if (rehearsal && !(await db.user.findFirst({ where: { username, deletedAt: null } })))
    await db.user.create({
      data: {
        username,
        name: 'Dueño de ensayo de migración',
        role: 'OWNER',
        passwordHash: await bcrypt.hash(randomBytes(24).toString('base64url'), 12),
      },
    });
  const owner = await db.user.findFirst({ where: { username, role: 'OWNER', deletedAt: null } });
  if (!owner) throw new Error('No se encontró el dueño activo indicado.');
  const target = new URL(process.env.DATABASE_URL!);
  console.info(
    JSON.stringify({
      database: target.pathname.slice(1),
      host: target.hostname,
      owner: owner.username,
    }),
  );
  const prior = await db.importBatch.findUnique({ where: { source: LEGACY_SOURCE } });
  if (apply && !prior) {
    const backup = await db.$transaction(
      async (tx) => ({
        createdAt: new Date().toISOString(),
        users: await tx.user.findMany(),
        categories: await tx.category.findMany(),
        products: await tx.product.findMany(),
        shifts: await tx.shift.findMany(),
        operations: await tx.operation.findMany(),
        items: await tx.operationItem.findMany(),
        payments: await tx.payment.findMany(),
        stockMovements: await tx.stockMovement.findMany(),
        quickButtons: await tx.quickButton.findMany(),
        stockRequests: await tx.stockRequest.findMany(),
        audit: await tx.auditLog.findMany(),
        idempotency: await tx.idempotency.findMany(),
        offlineConflicts: await tx.offlineConflict.findMany(),
        importBatches: await tx.importBatch.findMany(),
      }),
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    );
    const backupPath = join(
      folder,
      `respaldo-${rehearsal ? 'ensayo' : 'produccion'}-${stamp}.json`,
    );
    await writeFile(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
    console.info('Respaldo privado: ' + backupPath);
  }
  if (apply) {
    const credentialPath = join(
      folder,
      `credenciales-${rehearsal ? 'ensayo' : 'produccion'}-${stamp}.json`,
    );
    const result = await importLegacy(db, plan, owner.id, async (credentials) => {
      await writeFile(
        credentialPath,
        JSON.stringify(
          {
            note: 'Contraseñas temporales. Deben cambiarse en el primer ingreso. La cuenta adminjuan existente no se modifica.',
            users: credentials,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
    });
    console.info(
      result.replayed
        ? 'Fuente ya importada: no se cambió ningún registro.'
        : 'Importación confirmada. Credenciales privadas: ' + credentialPath,
    );
  }
  const checks = await verifyLegacy(db, plan);
  const { byDay, ...brief } = checks;
  console.info(JSON.stringify({ verification: { ...brief, daysChecked: byDay.length } }, null, 2));
  await writeFile(
    join(folder, `verificacion-${rehearsal ? 'ensayo' : 'produccion'}-${stamp}.json`),
    JSON.stringify(checks, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
  if (!checks.ok) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
