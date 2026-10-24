# Kiosco — reglas de trabajo

## Comandos
- `npm ci` / `npm run dev` / `npm run build`
- `docker compose up -d --wait` — Postgres local, puerto 54329.
- `npm run db:migrate` — migraciones versionadas; `npm run db:seed` — categorías y botones, sin usuarios ni datos reales.
- `npm run crear-dueno` — alta interactiva sin contraseña predeterminada.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:e2e`.

## Reglas
- Node + Next.js + TypeScript estricto; Prisma/Postgres en Supabase; Vercel. Sin Railway.
- Todo endpoint salvo login y health exige sesión. Identidad exclusivamente de sesión. Permisos leídos de DB en cada petición.
- Stock únicamente mediante transacciones atómicas y movimientos Kardex. Editar producto no modifica stock.
- Cobros idempotentes persistidos. Dinero en centavos enteros. UTC en DB; negocio en Buenos Aires.
- API nunca cacheada en service worker. Offline pendiente no equivale a venta confirmada.
- Español argentino, mobile-first 390 px, oscuro, controles >=44 px.
- No modificar/importar datos originales sin pedido explícito. La importación histórica se realizará después.
- No secretos ni datos de producción en Git. Sin cuentas o contraseñas predeterminadas.
- Ejecutar checks y actualizar PROGRESS.md antes de commits. No avanzar con tests fallando.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
