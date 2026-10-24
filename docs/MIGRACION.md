# Migración de la copia disponible

El importador lee `productos.json`, `usuarios.json` y `turnos_ultimos_100.json`, sin modificarlos. Los archivos reales, respaldos, informes y credenciales quedan fuera de Git y del paquete Vercel.

## Comandos

```powershell
npm run migrar
npm run migrar -- --rehearsal
npm run migrar -- --apply --owner adminjuan
npm run migrar -- --verify --owner adminjuan
```

El primer comando solo valida y prepara un informe privado. El ensayo crea `kiosco_import_test` exclusivamente en PostgreSQL local con UTF-8 y aplica las migraciones. `--source-dir` permite indicar otra carpeta de origen.

La aplicación real usa `DIRECT_URL` con TLS verificado. Antes de importar guarda una copia consistente de las tablas de negocio existentes en `data/migracion/respaldo-produccion-*.json`. Luego inserta el lote completo y concilia cantidades, stock, importes, ventas por turno y por fecha de negocio, e ítems. Si algo falla, revierte toda la transacción. Los respaldos contienen hashes de contraseña: conservarlos privados.

## Qué se conserva

- 914 productos con costo, precio, stock y mínimo originales. Se unifican categorías y se conservan los códigos manuales. Un código repetido al quitar espacios recibe `LEGACY-318`; el original permanece en el lote de procedencia y en el informe. No se fusionan productos automáticamente.
- Agua caliente conserva su saldo original pero queda sin control de stock. El saldo inicial de cada producto tiene un movimiento Kardex de importación; las ventas históricas no vuelven a descontarlo.
- Cinco usuarios con roles y permisos originales, contraseña temporal aleatoria y cambio obligatorio al ingresar. La cuenta dueña existente permanece intacta. Las credenciales se guardan únicamente en un archivo privado local.
- Los últimos 100 turnos y sus 3.324 ventas, con 5.369 ítems. Fechas sin zona del sistema anterior se interpretan como hora argentina y se guardan en UTC. El turno noche pertenece al día en que comienza.
- Los turnos importados son históricos, incluso los dos que estaban abiertos en la copia. No bloquean una apertura nueva ni pueden seguir recibiendo ventas. Las ventas históricas son de consulta y no admiten anulación operativa que altere el saldo actual.
- La tabla privada `import_batches` conserva el origen completo, checksum e informe. Una repetición del mismo lote no duplica ni actualiza datos. Una fuente modificada con el mismo identificador se rechaza.

## Límites de esta copia

El archivo no contiene contraseñas anteriores, Kardex, auditoría, consumos/retiros separados, costos históricos ni ventas fuera de esos 100 turnos. Los 55 pagos mixtos conservan su total como pendiente de desglose, sin asignación ficticia a efectivo o MP. Costo y ganancia históricos se muestran como sin datos. Tampoco se inventan diferencias de caja anteriores.

Hay 39 productos señalados para revisión; no se corrigen costos o precios sin información del dueño. Los dos productos con precio cero aparecen en Stock y quedan fuera de Caja. Al corregir y guardar un precio válido se habilitan. Los códigos originales y los motivos de revisión quedan en el informe.

La copia fue tomada el 23/10/2026. No representa movimientos posteriores del sistema anterior. Para un corte operativo definitivo se necesita una copia actualizada si ese sistema siguió vendiendo.
