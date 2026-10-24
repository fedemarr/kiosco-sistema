# Arquitectura

Un monolito modular. La interfaz y la API viven en Next.js App Router y se ejecutan sobre Node 24. No se necesita desplegar ni mantener un segundo backend.

```
Celular / PC (React, Tailwind)
           │ cookie httpOnly + validación de origen
           ▼
API Next.js, runtime Node
           │ sesión real, permisos, Zod, límites persistidos
           ▼
Módulos: auth / users / stock / shifts / sales / reports
           │ Prisma + transacciones SERIALIZABLE con reintentos
           ▼
PostgreSQL (Supabase; local para desarrollo y pruebas)
```

## Organización
- `src/app`: rutas, layouts y handlers HTTP.
- `src/modules`: comportamiento y pantallas por función del negocio.
- `src/lib`: infraestructura compartida, transacciones, formato y contratos.
- `prisma/migrations`: esquema versionado, índices parciales, checks y RLS.
- `tests`: lógica y pruebas contra PostgreSQL real.
- `e2e`: pruebas de navegador a 390×844 y escritorio.
- `scripts`: dueño interactivo, seed sin productos y herramientas locales.

## Decisiones
- Supabase se usa como Postgres privado. El navegador no recibe credenciales de DB ni una service role key. Login por usuario, sin email, con bcrypt compatible con los hashes anteriores.
- Cookie firmada HS256, sesiones persistidas y revocables, simultáneas, de 7 días. El usuario y sus permisos se vuelven a leer por petición.
- Todas las operaciones sensibles validan sesión, permiso y entrada. Escrituras HTTP requieren Origin del APP_URL configurado.
- Dinero entero en centavos, fechas timestamptz en UTC. Fechas de negocio y recargo en Buenos Aires.
- Una operación tiene tipo SALE, EMPLOYEE o OWNER. Esto mantiene consumos y retiros diferenciados, con ítems y pagos históricos propios.
- El costo y precio se copian en cada ítem: cambiar un precio o costo no modifica los reportes del pasado.
- Una cotización firmada vincula usuario, carrito e importes. El servidor vuelve a calcular antes del cobro y avisa si cambió.
- El turno se bloquea para serializar venta y cierre. El descuento de stock usa UPDATE condicional y se registra junto con el Kardex. El retiro y la anulación tienen auditoría.
- La clave de idempotencia única queda en DB con hash de la petición y referencia al cobro. Una clave reutilizada con otros datos se rechaza.
- Índices parciales: un turno abierto por usuario, un username activo normalizado, una solicitud de stock pendiente.
- RLS sin políticas públicas y revocación a anon/authenticated: las tablas no se consultan desde la API pública de Supabase.
- Offline: catálogo y contexto de turno en IndexedDB, separados del caché HTTP. Una autorización firmada liga el cobro al usuario y turno originales. Al sincronizar se comprueban sesión, stock y total actuales. Rechazos guardados en DB para revisión del dueño desde cualquier dispositivo.
- Se precachea un shell público sin datos de usuario para reabrir sin conexión. La API y documentos autenticados nunca se guardan en el service worker. El catálogo local no contiene costos ni contraseñas.
- Anular un producto fusionado devuelve las unidades al destino, manteniendo el Kardex.
- Sin Redis ni microservicios: no aportan una ventaja necesaria para cuatro usuarios. Los límites se guardan en PostgreSQL para funcionar en varias instancias.

## Consultas y actualización
Catálogo y stock paginados de 60 productos, Kardex y auditoría de 50. Stock se actualiza cada 15 segundos y al volver al primer plano o recuperar conexión. Reportes permiten hasta 93 días y 1.000 turnos por consulta; se indica si el resultado se truncó.

El esperado y la diferencia guardados al cierre representan el control físico en ese instante. Anulaciones posteriores dejan auditoría y se excluyen de las ventas actuales; no reescriben el efectivo que se contó históricamente.
