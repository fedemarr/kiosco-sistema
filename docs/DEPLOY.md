# Supabase + Vercel

Este proyecto reemplaza al anterior cuando se complete el corte. No necesita Railway. No ejecutar la importación real hasta que el dueño lo pida.

## Despliegue actual · 24/10/2026
- Aplicación: https://kiosco-sistema-beta.vercel.app
- Vercel: equipo fmcodes-projects, proyecto kiosco-sistema, región de funciones gru1.
- GitHub conectado: fedemarr/kiosco-sistema, rama main.
- Supabase conectado con TLS verificado y cuatro migraciones aplicadas; secretos solo en producción. La cuenta dueña pedida ya está creada. La importación histórica sigue pendiente.
- Verificados health, login, cookies seguras, acceso a Usuarios y tres turnos; interfaz de celular/escritorio sin errores de JavaScript ni scroll horizontal.
- vercel.json fija Next.js, npm ci, migraciones antes del build y región. .vercelignore limita los archivos subidos para excluir datos privados y entornos locales.

## 1. Crear PostgreSQL en Supabase
1. Crear un proyecto dedicado, elegir una región cercana a los usuarios y guardar la contraseña de DB en un gestor seguro.
2. En Connect, copiar la URL del **transaction pooler** para `DATABASE_URL` (puerto 6543) y la conexión directa o **session pooler** para `DIRECT_URL` (5432). URL-encodear caracteres especiales de la contraseña y quitar los corchetes que sean parte del ejemplo del panel. El proyecto incluye la CA pública de Supabase y verifica certificado y hostname; prisma.config.ts agrega la CA al motor de migraciones. No desactivar la verificación TLS.
3. El backend usa Prisma con `@prisma/adapter-pg` y un pool máximo de 5 conexiones por instancia. En planes pequeños limitar concurrencia de funciones si fuera necesario.
4. Usar un usuario de DB privado con permisos sobre las tablas y BYPASSRLS, siguiendo la guía oficial de Prisma de Supabase. No usar claves anon o service_role como contraseña de PostgreSQL. El navegador no necesita SDK ni claves de Supabase.
5. `DIRECT_URL` debe permitir DDL para las migraciones. No usar transaction pooler para migraciones.

## 2. Crear el esquema y el dueño
Desde una terminal de confianza, configurar las URLs de ese proyecto en un `.env` local ignorado por Git, conservando las URLs locales por separado si se usan.

```sh
npm ci
npm run db:deploy
npm run db:seed
npm run crear-dueno
```

Seed crea solo categorías y los botones Pancho, Cigarrillo suelto y Gomitas. El comando de dueño pide nombre, usuario, clave oculta y confirmación. No hay cuenta predeterminada. No ejecutar `prisma db push` en producción.

Las migraciones habilitan RLS y retiran acceso a anon/authenticated. Verificar en Supabase que no haya políticas públicas sobre las tablas del kiosco. Las claves y conexiones solo se configuran del lado servidor.

## 3. Vercel
1. Importar el repositorio GitHub como proyecto Next.js con Node **24.x**.
2. Configurar las variables para Production y, con una base distinta, para Preview:

| Variable | Uso |
|---|---|
| DATABASE_URL | Transaction pooler de Supabase, solo servidor |
| DIRECT_URL | Conexión directa/session pooler para migraciones, sin rutas locales a certificados (se agregan por código) |
| SESSION_SECRET | Clave aleatoria de al menos 32 caracteres; generar 48 bytes |
| APP_URL | Origen público exacto, por ejemplo https://kiosco.example.com, sin ruta |
| TEST_DATABASE_URL | Solo desarrollo/CI: base separada cuyo nombre termina en `_test` |

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

3. Build Command recomendado para producción: `npm run db:deploy && npm run build`. Install: `npm ci`. La migración precede al build y es versionada. Previews deben usar **su propia base**, nunca migrar automáticamente la base productiva desde una rama.
4. Definir APP_URL con el dominio definitivo y volver a desplegar si cambia. Un origen de preview distinto necesita su APP_URL; no se aceptan orígenes arbitrarios.
5. Ingresar, probar Caja/Stock y crear los usuarios. Cada empleado cambia su contraseña temporal.

## 4. Verificación previa al uso real
- CI local o GitHub en verde: lint, TypeScript, tests de PostgreSQL, Playwright y build.
- Login en celular y PC en simultáneo. Dar y quitar permiso de stock con la sesión abierta.
- Abrir turno, cobrar en efectivo/MP/tarjeta/mixto, ver vuelto y cerrar con diferencia.
- Probar el recargo nocturno y un consumo de empleado sin recargo.
- Confirmar que repetir una petición conserva un solo cobro.
- Probar corte de conexión en un dispositivo y sincronización antes de cerrar su turno.
- Verificar `GET /api/products` sin cookie devuelve 401 y que el navegador no cachea API.
- Probar descarga Excel y confirmar RLS sin acceso público en Supabase.

## Backups y restauración
Consultar en el panel de Supabase la retención y disponibilidad real del plan contratado. Configurar backups automáticos o PITR según el plan y probar una restauración en otro proyecto. No asumir que un proyecto gratuito tiene retención suficiente. Mantener un volcado cifrado independiente antes de cada migración importante.

## Corte futuro (no ejecutado)
1. Validar el sistema nuevo y resolver todos los cobros offline pendientes.
2. Elegir una franja de poco movimiento, cerrar turnos y detener ventas en el sistema anterior.
3. Obtener una copia final del sistema anterior e importar en una base preparada.
4. Verificar productos, stock por producto, códigos manuales y totales diarios de la última semana.
5. Revisar los productos con costo faltante o venta menor/igual al costo. Agua caliente se configura sin control de stock.
6. Pasar todos los dispositivos al sistema nuevo. Conservar el anterior para consulta y un respaldo antes de darlo de baja.

## Referencias oficiales
- [Supabase: Prisma](https://supabase.com/docs/guides/database/prisma)
- [Supabase: conexiones PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Next.js: despliegue](https://nextjs.org/docs/app/getting-started/deploying)
