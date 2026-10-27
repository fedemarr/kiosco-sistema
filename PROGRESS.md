# Progreso · 24/10/2026

## Operativa POS, ingresos y reportes · 27/10/2026
- Turnos: orden explícito de más reciente a más antiguo con fecha/hora y desempate por ID. Se quitó el corte de 100 operaciones del turno actual. Total vendido completo, cobrado y desglose por efectivo/MP/tarjeta; detalle común con ítems, cantidades, subtotales, recargos/descuentos y pagos. En celular el resumen se amplía sobre Caja para poder consultar operaciones.
- Búsqueda por tokens parciales independientes, sin importar orden ni mayúsculas, en catálogo, Stock y catálogo offline. Mantiene lectura por código y escape literal de comodines SQL. No implementa corrección automática de errores ortográficos.
- Efectivo: con recibido vacío se ofrece “Cobrar justo” en un clic y se envía recibido igual al total cotizado; con importe explícito se valida el vuelto. Conserva persistencia previa del cobro, clave idempotente y validación de precio/stock. Errores de stock detallan producto, solicitado y disponible; la validación se aplica a todos los medios.
- Stock: historial de los últimos 30 ingresos confirmados del usuario, con fecha/hora, cantidad y antes/después. Se consulta desde Kardex con permisos vigentes y se conserva tras recargas; cargas pendientes no se presentan como confirmadas ni crean filas duplicadas.
- Reportes: formulario Desde/Hasta visible arriba, aplicable a turnos, resumen, empleados y gráfico. Hasta 93 días por consulta, sin mínimo histórico. Fechas inválidas rechazadas, se elimina el recorte de 1.000 turnos y se muestran todos los días del rango en el gráfico, con proyección calculada sobre el período real. Mantiene día operativo y refresco automático.
- Sin cambios de esquema ni migraciones de datos. No se modifican ventas, stock ni turnos reales durante las pruebas. Cache offline v11.
- Validación: TypeScript, lint y build de producción correctos; 50 pruebas de lógica/PostgreSQL y 16 E2E aprobadas. Flujo nuevo verificado en 390 px y escritorio: búsqueda inversa, dos ingresos visibles tras recargar, cobro exacto con recibido igual al pago, detalle/total de turno, stock insuficiente y rango de ocho días sin cortar el gráfico. Capturas del detalle de turno revisadas.

## Reportes automáticos y día operativo · 26/10/2026
- Investigación de solo lectura en Supabase: las 4 ventas iniciales de Yoel, por $14.190, estaban guardadas en su turno NIGHT del día operativo 25/10 aunque una se registró después de medianoche del 26/10. No se alteraron ventas ni turnos reales.
- El reporte abre por defecto el día operativo actual (06:00 a 06:00 de Buenos Aires), igual en API y pantalla. Avanza automáticamente a las 06:00; una fecha elegida manualmente se conserva, con opción “Ver día actual”.
- Reportes y alertas consultan cada 2 segundos en pestañas visibles, con actualización al recuperar foco/conexión. Se muestra última consulta y estado de error/reintento. El resto de las pantallas conserva su intervalo de 15 segundos. Se evitan consultas superpuestas y respuestas de filtros anteriores.
- Cache offline v10. Pruebas locales cubren ventas/anulaciones desde otra sesión con reporte abierto, madrugada, cambio a las 06:00 y conservación de filtros.
- Validación: build de producción, TypeScript, lint, 38 pruebas PostgreSQL/lógica y 14 E2E aprobadas en bases locales. Los reportes reales se contrastaron por lectura directa; no se crearon operaciones de prueba en Supabase.

## Controles compactos · 26/10/2026
- Menú lateral de 216 px (antes 256), enlaces de 44 px y tipografía/iconos más pequeños. Más ancho disponible para productos.
- Filas del carrito con 2 px de padding vertical y controles visibles de cantidad más pequeños, conservando un área táctil de 44 px. Métodos de pago en una fila de 44 px en escritorio y botón Cobrar de 48 px; menor separación en el pie.
- Conserva el scroll del carrito y el aviso nocturno. Cache offline v9. Cambio exclusivamente visual, sin modificar ventas ni stock.
- Validación: lint, build con TypeScript y 10 pruebas E2E aprobadas. Captura de escritorio revisada con 12 productos: más filas visibles y cobro accesible; controles táctiles de 44 px verificados.

## Tarifa nocturna visible · 26/10/2026
- Franja ámbar con luna sobre el buscador: “Tarifa nocturna activa — +10% (22:00 a 06:00)”. Botón Cobrar ámbar con luna y desglose del importe del recargo en ventas. Estilo basado en la captura del sistema anterior.
- Se conserva el cálculo existente: +10% en ventas entre 22:00 inclusive y 06:00 exclusive de Buenos Aires, para todos los medios de pago; consumos y retiros conservan sus reglas. No se aplica el recargo dos veces.
- Ajustes compactos en celular para mantener el carrito accesible también con aviso nocturno y pago mixto. Cache offline v8.
- Build, lint, 38 pruebas de lógica/PostgreSQL y 10 pruebas E2E aprobados. Prueba de navegador con reloj controlado verifica aparición a las 22:00 y desaparición a las 06:00, sin recargar. Capturas de escritorio y celular revisadas. Sin cambios en datos de producción.

## Ajuste de carrito POS · 26/10/2026
- Panel limitado al alto de la ventana; buscador y cobro fuera del scroll, cuerpo flexible con min-height: 0 y lista con scroll vertical propio. Búsqueda y venta rápida usan el cuerpo disponible al abrirse.
- Filas más compactas, controles táctiles de 44 × 44 px, avisos acotados con scroll para conservar espacio sin conexión. Los avisos de cotización quedan antes del total para evitar que muevan el botón Cobrar.
- Cache offline v7. Sin cambios en ventas, stock, pagos ni datos de producción.
- Validación: lint, TypeScript y build correctos; 8 pruebas E2E aprobadas en PostgreSQL local, incluida regresión de 12 productos y edición/eliminación del último ítem en 390×844, 1024×768, 1280×720 y 1366×768 con efectivo, mixto y Mercado Pago. Capturas inspeccionadas en celular y escritorio.

## Alcance y referencias
Sistema nuevo con Node/Next.js, Supabase y Vercel, sin Railway. Leídos completos PROMPT_CODEX.md y PROMPT_NUEVO_SISTEMA.md. No estaba docs/ESPECIFICACION.md: se siguieron ambos prompts. La importación de los archivos disponibles fue autorizada y aplicada el 24/10/2026; originales intactos y excluidos de Git.

## Estado por etapa
- **Diseño según capturas del 24/10, publicado:** Caja con buscador/lector, carrito central, cobro inferior con cuatro botones y resumen lateral del turno; panel del dueño con Turnos, Hoy, Semana, Empleados, Stock y Alertas. Paleta azul/violeta, gráficos de pagos, resumen por empleado/producto, ingreso de stock desde alertas y auditoría filtrable. Adaptación a 390 px. Revisión visual y flujo completo verificados con Playwright. Las búsquedas nuevas limpian resultados anteriores y las consultas filtradas descartan respuestas de filtros viejos.
- **0 — Base implementada:** Node 24, Next 16, React 19, TypeScript estricto, Tailwind, Prisma 7, PostgreSQL, ESLint/Prettier, Vitest, Playwright y GitHub Actions. Lockfile con versiones exactas. Docker opcional y alternativa PostgreSQL embebido solo para desarrollo.
- **1 — Modelo, auth y permisos implementados:** usuarios, categorías, productos, turnos, operaciones diferenciadas, ítems, pagos, Kardex, solicitudes, idempotencia, auditoría, sesiones y conflictos offline. Seis migraciones con checks, índices parciales y RLS. Login normalizado, bcrypt, cookie httpOnly firmada de 7 días, sesiones simultáneas y permisos consultados en cada petición. Dueño por comando interactivo; sin cuenta predeterminada.
- **2 — Productos y stock implementados:** búsqueda paginada, alta/edición, baja lógica, reactivación por código, productos sin control de stock, ingresos y conteos con motivo si baja, Kardex, alertas, duplicados/fusión y Excel. Cambios atómicos con movimientos. Anulación posterior a fusión repone en destino.
- **3 — Caja y turnos implementados:** apertura con efectivo inicial, búsqueda/código, carrito, botones configurables, venta libre, efectivo/tarjeta/MP/mixto, vuelto, cotización, recargo nocturno, cobro idempotente, empleado −20% sin recargo, retiro a costo con motivo, anulación y cierre con esperado/contado/diferencia. Totales del turno incluyen todas las operaciones; pantalla muestra últimas 100.
- **4 — Reportes implementados:** resumen, medios de pago, costo/ganancia, top productos, evolución/proyección, turnos por fecha de negocio y empleado, detalle, ticket promedio, solicitudes, auditoría con filtros y exportación Excel. Anulaciones excluidas. Rango máximo 93 días y 1.000 turnos, con aviso al alcanzar el límite.
- **5 — PWA/offline implementados:** iconos, manifest, shell público para reapertura sin red, catálogo local sin costos, cola IndexedDB, autorización firmada por usuario/turno, reintentos con misma clave y sincronización al reconectar y periódica. Rechazos por stock/precio/turno guardados en DB para el dueño, con resolución auditada. API y documentos autenticados nunca cacheados. Refresco al volver al primer plano; stock cada 15 segundos.
- **6 — Importación aplicada y verificada en Supabase:** 914 productos, 5 usuarios anteriores, 100 turnos, 3.324 ventas, 5.369 ítems y $13.708.819,10. Conciliados todos los productos, ventas, ítems y 32 fechas de negocio, sin diferencias. `adminjuan` y su turno abierto preexistente conservados. Stock inicial con Kardex, categorías unificadas, Agua caliente sin control, dos precios cero fuera de Caja y 39 productos señalados. Históricos de consulta; costos ausentes y 55 mixtos sin desglose explícitos. Contraseñas temporales aleatorias con cambio obligatorio, en archivo privado local. Respaldo previo e informe de conciliación en `data/migracion/`, excluidos de Git y Vercel. Fuente íntegra y checksum en tabla privada con RLS. Ensayo/replay local exitosos. El dueño eligió los archivos disponibles del 23/10; no hay pg_dump.
- **7 — Publicado y verificado:** https://kiosco-sistema-beta.vercel.app, proyecto kiosco-sistema en fmcodes-projects, funciones en gru1 y repositorio GitHub conectado. Supabase con TLS verificado, seis migraciones aplicadas y RLS en todas las tablas. Variables privadas como secretos de producción. Health 200, rutas privadas 401, login real, cookies Secure/httpOnly y Usuarios verificados. Diseño nuevo publicado, catálogo e historial importados; navegador probado a 390×844 y 1920×900, sin desborde ni errores JavaScript. Las tres franjas de turno están disponibles. Refuerzo de stock/cobros publicado; conciliación real y CI sin errores. Último control adicional: vuelto, bloqueo de efectivo insuficiente y mixto sin efectivo, cubiertos por las seis pruebas de navegador.

## Verificación
- Auditoría adicional solicitada sobre stock y sumas: corregidos conteos desactualizados, Excel viejo que pisaba stock, reintentos de conflictos PostgreSQL en el adaptador actual y recuperación de cargas/cobros ante respuestas perdidas. Lecturas de integridad de Supabase: 914 productos, 3.324 operaciones y 914 movimientos iniciales, cero diferencias de stock, pagos, subtotales, costos conocidos o idempotencia. Ver `docs/AUDITORIA.md`.
- TypeScript estricto, tipos de rutas Next, lint y build de producción.
- **38 tests** de lógica/PostgreSQL real: permisos; 21:59/22:00/05:59/06:00; pagos; concurrencia del último ítem y cargas; replay simultáneo; conflicto de claves; rollback; cierre mixto; anulaciones simples y tras fusión; identidad/importe offline; conflictos persistidos y Excel sintético.
- **6 pruebas Playwright**, celular 390×844 y escritorio contra build de producción: login, protección/revocación de permisos, apertura, dos carritos offline, reapertura sin red, sincronización idempotente, cierre, stock, reportes y ausencia de desborde horizontal.
- Dependencias revisadas con npm audit: sin vulnerabilidades reportadas. Se sustituyó xlsx por ExcelJS con uuid corregido mediante override.
- Tests/fixtures exclusivamente en bases locales terminadas en `_test`. Supabase verificado con consultas de solo lectura después de la importación autorizada; no se registraron ventas de prueba en producción.
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
