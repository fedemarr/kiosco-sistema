# Revisión de stock y precisión · 24/10/2026

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
