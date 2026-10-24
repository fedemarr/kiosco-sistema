# Progreso · 24/10/2026

## Alcance y referencias
Sistema nuevo con Node/Next.js, Supabase y Vercel, sin Railway. Leídos completos PROMPT_CODEX.md y PROMPT_NUEVO_SISTEMA.md. No estaba docs/ESPECIFICACION.md: se siguieron ambos prompts. La importación real quedó pospuesta por pedido explícito; archivos originales intactos y excluidos de Git.

## Estado por etapa
- **Diseño según capturas del 24/10:** Caja con buscador/lector, carrito central, cobro inferior con cuatro botones y resumen lateral del turno; panel del dueño con Turnos, Hoy, Semana, Empleados, Stock y Alertas. Paleta azul/violeta, gráficos de pagos, resumen por empleado/producto, ingreso de stock desde alertas y auditoría filtrable. Adaptación a 390 px. Revisión visual y flujo completo verificados con Playwright. Las búsquedas nuevas limpian resultados anteriores y las consultas filtradas descartan respuestas de filtros viejos. Importación histórica autorizada ahora por el dueño: siguiente etapa, todavía sin ejecutar.
- **0 — Base implementada:** Node 24, Next 16, React 19, TypeScript estricto, Tailwind, Prisma 7, PostgreSQL, ESLint/Prettier, Vitest, Playwright y GitHub Actions. Lockfile con versiones exactas. Docker opcional y alternativa PostgreSQL embebido solo para desarrollo.
- **1 — Modelo, auth y permisos implementados:** usuarios, categorías, productos, turnos, operaciones diferenciadas, ítems, pagos, Kardex, solicitudes, idempotencia, auditoría, sesiones y conflictos offline. Cuatro migraciones con checks, índices parciales y RLS. Login normalizado, bcrypt, cookie httpOnly firmada de 7 días, sesiones simultáneas y permisos consultados en cada petición. Dueño por comando interactivo; sin cuenta predeterminada.
- **2 — Productos y stock implementados:** búsqueda paginada, alta/edición, baja lógica, reactivación por código, productos sin control de stock, ingresos y conteos con motivo si baja, Kardex, alertas, duplicados/fusión y Excel. Cambios atómicos con movimientos. Anulación posterior a fusión repone en destino.
- **3 — Caja y turnos implementados:** apertura con efectivo inicial, búsqueda/código, carrito, botones configurables, venta libre, efectivo/tarjeta/MP/mixto, vuelto, cotización, recargo nocturno, cobro idempotente, empleado −20% sin recargo, retiro a costo con motivo, anulación y cierre con esperado/contado/diferencia. Totales del turno incluyen todas las operaciones; pantalla muestra últimas 100.
- **4 — Reportes implementados:** resumen, medios de pago, costo/ganancia, top productos, evolución/proyección, turnos por fecha de negocio y empleado, detalle, ticket promedio, solicitudes, auditoría con filtros y exportación Excel. Anulaciones excluidas. Rango máximo 93 días y 1.000 turnos, con aviso al alcanzar el límite.
- **5 — PWA/offline implementados:** iconos, manifest, shell público para reapertura sin red, catálogo local sin costos, cola IndexedDB, autorización firmada por usuario/turno, reintentos con misma clave y sincronización al reconectar y periódica. Rechazos por stock/precio/turno guardados en DB para el dueño, con resolución auditada. API y documentos autenticados nunca cacheados. Refresco al volver al primer plano; stock cada 15 segundos.
- **6 — Importación histórica pospuesta:** no se ejecutó ni desarrolló importador de JSON/pg_dump antiguos. La importación Excel operativa está disponible y probada con archivo sintético. No se importaron productos, usuarios ni ventas anteriores.
- **7 — Publicado y verificado:** https://kiosco-sistema-beta.vercel.app, proyecto kiosco-sistema en fmcodes-projects, funciones en gru1 y repositorio GitHub conectado para próximos despliegues. Supabase con TLS verificado, cuatro migraciones aplicadas y RLS en todas las tablas. Cuenta de dueño creada por pedido explícito, con administración de usuarios. Variables privadas cargadas como secretos de producción y clave de sesión propia. Build remoto terminado; health 200, rutas privadas 401 sin sesión, login real, cookies Secure/httpOnly y acceso a Usuarios verificados. Navegador probado a 390×844 y 1440×900, sin desborde ni errores de JavaScript; selector con mañana/tarde/noche confirmado. Catálogo anterior sin importar.

## Verificación
- TypeScript estricto, tipos de rutas Next, lint y build de producción.
- **27 tests** de lógica/PostgreSQL real: permisos; 21:59/22:00/05:59/06:00; pagos; concurrencia del último ítem y cargas; replay simultáneo; conflicto de claves; rollback; cierre mixto; anulaciones simples y tras fusión; identidad/importe offline; conflictos persistidos y Excel sintético.
- **4 pruebas Playwright**, celular 390×844 y escritorio contra build de producción: login, protección/revocación de permisos, apertura, dos carritos offline, reapertura sin red, sincronización idempotente, cierre, stock, reportes y ausencia de desborde horizontal.
- Dependencias revisadas con npm audit: sin vulnerabilidades reportadas. Se sustituyó xlsx por ExcelJS con uuid corregido mediante override.
- Tests/fixtures exclusivamente en kiosco_test local. Supabase verificado con consultas de solo lectura después del setup.
- Capturas inspeccionadas en .screenshots (no versionadas). Falta validación manual en un celular físico del kiosco.
- Despliegue público probado por HTTP y navegador contra Supabase real, sin crear productos, turnos ni ventas de prueba. Capturas del despliegue en .screenshots/vercel-caja-mobile.png y vercel-usuarios-desktop.png. Paquete Vercel validado antes de subir: sin .env ni archivos de migración de datos originales.

## Probar desde esta carpeta
1. `.env` ya tiene la conexión de Supabase entregada por el dueño; no copiarla a Git. Respaldo del entorno local en `.env.local-backup`, ignorado.
2. `npm ci` y `npm run db:verify`.
3. La cuenta dueña solicitada ya está creada en Supabase. Para otra base vacía, `npm run crear-dueno` permite elegir usuario y contraseña de forma interactiva.
4. `npm run dev`, abrir http://localhost:3000 e ingresar. Abrir turno, crear producto en Stock y cargar unidades mediante Cargar.
5. Para tests, iniciar `npm run db:local` o Docker. TEST_DATABASE_URL apunta a kiosco_test local. Ejecutar `npm run lint`, `npm run typecheck`, `npm run test:db`.
6. `npm run build`; en PowerShell `$env:E2E_PRODUCTION='1'`; `npm run test:e2e`. Puerto de pruebas 3100, separado de 3000.
7. Ya publicado en https://kiosco-sistema-beta.vercel.app. APP_URL coincide con ese dominio; para cambiarlo, seguir docs/DEPLOY.md y volver a desplegar.

## Decisiones y límites explícitos
- Monolito modular: API Node de Next.js; sin servidor Express aparte. Supabase como Postgres privado; no necesita email, anon key ni service_role.
- Consumos/retiros son tipos propios, con ítems/pagos históricos y Kardex.
- Mixto exige suma exacta en centavos para evitar diferencias artificiales de hasta $1.
- Offline requiere abrir Caja previamente con internet y conservar la sesión original para sincronizar. Retiros del dueño requieren conexión. Cobros locales son pendientes hasta aceptación del servidor; varios dispositivos offline pueden competir por stock y el excedente será rechazado para revisión.
- La revisión del dueño documenta una resolución manual; no registra otra venta ni altera importes automáticamente. No borrar almacenamiento con cobros pendientes.
- El cierre conserva el esperado/contado en ese instante. Una anulación posterior no reescribe el conteo físico histórico.
- Costos faltantes o de ventas rápidas se consideran cero: revisar costos al importar antes de usar reportes para decisiones del negocio.
- Los datos anteriores con costos/precios dudosos, categorías variantes, Agua caliente y códigos manuales se revisarán al preparar la importación. No se modificaron ahora.
