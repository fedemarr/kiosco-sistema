import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolConfig } from 'pg';
export function postgresConfig(connectionString = process.env.DATABASE_URL): PoolConfig {
  if (!connectionString) return { max: 5, connectionTimeoutMillis: 15000 };
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co')) {
    // pg y el motor de migraciones usan nombres distintos para el certificado raíz.
    for (const key of ['sslmode', 'sslcert', 'sslrootcert', 'sslaccept'])
      url.searchParams.delete(key);
    const ca =
      process.env.SUPABASE_CA_CERT ||
      readFileSync(join(process.cwd(), 'certs/supabase-ca.crt'), 'utf8');
    return {
      connectionString: url.toString(),
      ssl: { ca, rejectUnauthorized: true },
      max: 5,
      connectionTimeoutMillis: 15000,
    };
  }
  return { connectionString, max: 5, connectionTimeoutMillis: 15000 };
}
