# Revisión de stock y precisión · 24/10/2026

## Revisión adicional · 10/11/2026

- Lectura consistente de producción: 930 productos, 5.359 operaciones y 4.612 movimientos. Sin diferencias de stock contra Kardex, de pagos contra totales, de ítems/costos conocidos, de descuentos por operación/producto ni claves faltantes de idempotencia. Informe privado en `data/auditoria/integridad-2026-11-10T13-07-01-583Z.json`.
- Comprobación adicional: 341 ingresos registrados, sin faltantes de reposición en operaciones anuladas y sin productos fusionados activos. Agua caliente es el único producto activo configurado sin control de unidades; se conserva esa configuración existente.
- Se reprodujo en navegador una carga de 5 unidades que se guardaba correctamente pero quedaba mostrando el saldo anterior por una consulta demorada. Los eventos de cambios confirmados ahora fuerzan una consulta nueva e invalidan las anteriores. Guardar/editar/importar en Stock también solicita una lectura nueva; las respuestas anteriores no pueden volver a pintar el saldo viejo.
- Se reprodujo con un Excel sintético la reactivación incorrecta de un código fusionado. Se rechaza todo el archivo con ese código y se indica usar el producto destino. La transacción revierte también los productos procesados antes de esa fila; no altera saldos ni reactiva el origen.
- Nuevas regresiones: dos ingresos, una venta y una edición simultáneas terminan con todas las unidades conciliadas; un reintento de ingreso no suma dos veces. La prueba de navegador retiene una lectura anterior, registra un ingreso, libera la respuesta vieja y verifica el saldo actualizado antes y después de recargar.
- No se modificó stock, ventas, pagos, movimientos ni configuración de productos reales durante esta revisión. Las reproducciones usan exclusivamente la base local `_test`.
- Validación de la actualización: 58 pruebas de lógica/PostgreSQL y 26 pruebas de navegador en celular y escritorio, build, TypeScript y lint aprobados. Los dos fallos corregidos se reprodujeron antes de aplicar sus soluciones.

## Correcciones verificadas

- Un Excel anterior podía reemplazar el stock actual por su columna vieja. Ahora actualiza metadatos y conserva el stock de productos existentes; solo carga el saldo inicial al crear un producto nuevo. Los conteos físicos se hacen en Corregir.
- Un conteo abierto en otra pantalla ahora incluye el stock observado. Si hubo otra carga o venta, se rechaza con un mensaje para actualizar, conservando el movimiento nuevo.
- Algunos conflictos serializables de consultas SQL llegaban bajo `driverAdapterError.cause`, y no se reintentaban. Se reconocen los códigos 40001/40P01 del adaptador y se reintenta con una espera acotada.
- Cargar mercadería tiene una clave única persistida y hash de solicitud. El mismo reintento devuelve el movimiento original; cambiar sus datos con la misma clave se rechaza. La intención se guarda en IndexedDB antes de enviar y se puede confirmar después de recargar el navegador.
- El cobro guarda su clave e intención antes del POST. Una respuesta perdida o recarga conserva esa clave y sincroniza una sola operación. Los rechazos confirmados liberan la intención; una falla de almacenamiento impide enviarla. El carrito se bloquea mientras se cobra.
- Lecturas rápidas consecutivas del escáner se procesan independientemente, limpiando la entrada al recibir Enter y esperando las búsquedas pendientes antes de cobrar.
- El botón de cobro exige efectivo suficiente e importes válidos. Mixto permite parte efectivo cero cuando el total se paga por MP, sin exigir un billete recibido ficticio. Se verifican también el vuelto y los centavos en el navegador.

## Controles de los errores anteriores

Se revisaron los 14 puntos de la sección 8 del prompt: migraciones versionadas, lockfile, identidad de sesión, roles/usuario normalizados, stock atómico, edición sin stock, API fuera de caché, cotización de servidor, horarios argentinos/UTC, idempotencia en PostgreSQL, secretos ignorados, exclusión de compilados, estados de error y protección de doble envío. La auditoría no encontró un temporizador que borre stock: los únicos cambios permitidos son ventas, consumos, retiros, anulaciones, ingresos, conteos, fusiones y saldos iniciales, todos con Kardex.

## Evidencia

- 38 pruebas de lógica y PostgreSQL real, incluidas concurrencia, último ítem, cargas simultáneas, carga con venta, conteo con carga, reintentos, rollback, centavos, recargo en 22/06, empleado −20%, retiro a costo, pagos mixtos, cierre, anulación y fusión. Migración sintética con rollback/replay y ensayo íntegro de los archivos reales en base local separada.
- Seis pruebas de navegador en celular y escritorio contra build de producción. Se corta deliberadamente la respuesta después de que el servidor aceptó una venta o carga; se recarga el navegador y se comprueba que quede una sola operación y el saldo correcto. También se verifican escaneos consecutivos, dos carritos offline, reapertura, sincronización, permisos y reportes.
- `npm run verificar:integridad` realiza una lectura consistente y no modifica datos. Compara stock con suma de Kardex; pagos con total; ítems y costos conocidos; descuentos de stock por producto y operación; claves de idempotencia de las operaciones nuevas. Guarda un informe privado en `data/auditoria/`. `--test` usa exclusivamente `TEST_DATABASE_URL`.

## Límites

Una prueba correcta no garantiza ausencia absoluta de fallas. Los controles comprueban consistencia de lo registrado; no sustituyen un conteo físico ni recuperan datos ausentes del export anterior. La copia importada es del 23/10/2026, tiene 39 productos para revisión y no trae costos históricos ni desglose de 55 pagos mixtos. Estos huecos se muestran explícitamente. No se crean ventas de prueba en producción.
