# Kiosco

Sistema nuevo de punto de venta. Node 24, Next.js App Router, TypeScript estricto, Tailwind y Prisma 7. PostgreSQL en Supabase, aplicación en Vercel. Sin dependencia de Railway.

## Desarrollo
1. `npm ci`
2. Copiar `.env.example` a `.env` y generar `SESSION_SECRET` con el comando incluido.
3. `docker compose up -d --wait` (o `npm run db:local` si no tenés Docker funcionando).
4. `npm run db:migrate` y `npm run db:seed`
5. `npm run crear-dueno`
6. `npm run dev` y abrir http://localhost:3000.

Supabase también puede usarse en desarrollo: configurar `DATABASE_URL` y `DIRECT_URL`, sin Docker. No compartir una base de producción con los tests.

## Calidad
`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run build`.

`test:db` y `test:e2e` usan `TEST_DATABASE_URL`, cuyo nombre debe terminar en `_test`. Nunca se usan los datos de Supabase productivo en pruebas. Para ejecutar E2E contra el build de producción: compilar y configurar `E2E_PRODUCTION=1` antes de `npm run test:e2e`.

La conexión con Supabase verifica el certificado público incluido en `certs/`. `npm run db:verify` comprueba conexión, conteos y RLS sin escribir datos.

## Estructura
Los módulos están en `src/modules` (auth, users, stock, shifts, sales, reports y offline). `src/app/api` aplica sesión, permisos y validación. Ver [arquitectura](docs/ARCHITECTURE.md), [API](docs/API.md) y [despliegue](docs/DEPLOY.md).

Los archivos originales de productos, usuarios y turnos quedan fuera de Git e intactos. La importación se hará en otra etapa.

Ver PROGRESS.md para el estado real y docs/DEPLOY.md para despliegue.
