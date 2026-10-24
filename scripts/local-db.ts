import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Alternativa local a Docker. Nunca se conecta a Supabase ni al sistema anterior.
const databaseDir = resolve('.local-postgres');
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'kiosco',
  password: 'local_only_change_me',
  port: 54329,
  persistent: true,
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});
if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
for (const name of ['kiosco', 'kiosco_test']) {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!result.rowCount)
    await client.query(`CREATE DATABASE ${name} ENCODING 'UTF8' TEMPLATE template0`);
}
await client.end();
console.info(
  'PostgreSQL local en 127.0.0.1:54329. Bases kiosco y kiosco_test. Ctrl+C para detener.',
);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
