import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';
function migrationUrl() {
  const value = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!value) return undefined;
  const url = new URL(value);
  if (url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co')) {
    url.searchParams.set('sslmode', 'require');
    url.searchParams.set('sslaccept', 'strict');
    url.searchParams.set('sslcert', resolve('certs/supabase-ca.crt'));
  }
  return url.toString();
}
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx scripts/seed.ts' },
  datasource: { url: migrationUrl() },
});
