import 'dotenv/config';
import { spawnSync } from 'node:child_process';
const url = new URL(
  process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://kiosco:local_only_change_me@localhost:54329/kiosco_test',
);
if (!process.env.TEST_DATABASE_URL) {
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error(
      'Configurá TEST_DATABASE_URL con una base exclusiva de pruebas. No se deduce de una URL remota.',
    );
  url.pathname = '/kiosco_test';
}
if (!url.pathname.endsWith('_test')) throw new Error('La base de pruebas debe terminar en _test.');
const e2e = process.argv.includes('--e2e');
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  DIRECT_URL: url.toString(),
  RUN_DB_TESTS: '1',
  APP_URL: e2e ? 'http://localhost:3100' : 'http://localhost:3000',
  SESSION_SECRET:
    process.env.SESSION_SECRET || 'only-for-automated-tests-secret-32-characters-minimum',
};
const cli = (file: string, args: string[]) =>
  spawnSync(process.execPath, [file, ...args], { env, stdio: 'inherit' });
let result = cli('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
if (result.status !== 0) process.exit(result.status || 1);
result = e2e
  ? cli('node_modules/@playwright/test/cli.js', ['test'])
  : cli('node_modules/vitest/vitest.mjs', ['run']);
process.exit(result.status || 0);
