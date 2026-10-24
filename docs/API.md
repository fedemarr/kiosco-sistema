# API del kiosco

Todas las rutas salvo POST `/api/auth/login` y GET `/api/health` requieren sesión. No se admite `usuario_id`/`userId` para asignar identidad en cuerpos de negocio. Escrituras requieren cabecera Origin igual al APP_URL. Los importes son centavos enteros.

Respuesta JSON: `{ success: true, data }` o `{ success: false, error: { code, message, details? } }`. Respuestas sin caché. Descargas Excel son binarias. Entrada validada con Zod.

| Ruta | Método | Permiso | Función |
|---|---|---|---|
| /api/auth/login | POST | Pública, limitada | Usuario y contraseña |
| /api/auth/me | GET | Sesión | Identidad y permisos actuales |
| /api/auth/logout | POST | Sesión | Cerrar la sesión actual |
| /api/auth/password | POST | Sesión | Cambiar clave, revocar sesiones |
| /api/catalog?q=&page=&category= | GET | Caja | Buscar productos y precios, sin costo |
| /api/categories | GET / POST | Caja / dueño | Listar / crear categorías |
| /api/quick | GET / POST | Caja / dueño | Listar / crear o editar botón rápido |
| /api/products?q=&page= | GET / POST | Stock | Lista / alta o reactivación por código |
| /api/products/:id | PATCH / DELETE | Stock | Editar metadatos / baja lógica |
| /api/products/:id/movements?page= | GET / POST | Stock | Kardex / ingreso o conteo con motivo |
| /api/products/duplicates | GET | Dueño | Detectar nombres repetidos |
| /api/products/merge | POST | Dueño | Fusionar stock y dar de baja origen |
| /api/stock-requests | POST / GET | Caja / dueño | Solicitar / ver pendientes |
| /api/stock-requests/:id | PATCH | Dueño | Aprobar o rechazar |
| /api/shifts/current | GET | Caja | Turno propio y sus últimas operaciones |
| /api/shifts/open | POST | Caja | Abrir con tipo y efectivo inicial |
| /api/shifts/close | POST | Caja | Cerrar con efectivo contado |
| /api/sales/quote | POST | Caja | Cotización de carrito |
| /api/sales | POST | Caja | Cobro idempotente y transaccional |
| /api/sales/sync | POST | Caja | Sincronizar con la misma clave; guardar rechazos para revisión |
| /api/offline-conflicts | GET | Dueño | Cobros rechazados por revisar |
| /api/offline-conflicts/:key | GET / PATCH | Propio/dueño / dueño | Estado / documentar resolución manual |
| /api/sales/:id/void | POST | Dueño | Anulación con motivo y restitución |
| /api/reports?from=&to= | GET | Dueño | Reportes por fecha de negocio |
| /api/users | GET / POST | Dueño | Lista / alta con clave temporal |
| /api/users/:id | PATCH | Dueño | Permisos y activación |
| /api/audit?page=&from=&to=&user=&action= | GET | Dueño | Auditoría filtrada |
| /api/exports?kind=products | GET | Dueño | Excel del catálogo |
| /api/exports?kind=reports&from=&to= | GET | Dueño | Excel de turnos y resumen |
| /api/imports | POST | Dueño | Multipart `file`: Excel .xlsx hasta 2 MB / 2.000 filas |

## Carrito y cobro
Carrito: `{ type: 'SALE'|'EMPLOYEE'|'OWNER', items, note? }`. Ítems: `{ kind:'product', productId, quantity }`, `{ kind:'quick', quickId, quantity }` o `{ kind:'custom', name, price, quantity }`.

Cobro agrega `shiftId`, `quoteToken`, `idempotencyKey` UUID, `payments: [{method:'CASH'|'MP'|'CARD',amount}]` y `received` si hay efectivo. Mixto requiere efectivo + MP con suma exacta. No se usa tolerancia monetaria para evitar diferencias en caja. Owner no lleva pagos y requiere motivo.

Sin conexión se envía `offline:true`, `offlineToken` (autorización firmada del turno actual) y `expectedTotal` (lo cobrado), en lugar de quoteToken. Si la tarifa o precios actuales cambiaron, el servidor rechaza y deja el cobro para revisión; nunca altera automáticamente el importe ya cobrado. La sesión y turno corresponden al empleado original.

## Errores de negocio
- 401: sesión ausente, inválida, vencida o revocada.
- 403: permiso, origen o cambio obligatorio de clave.
- 400: validación, pago insuficiente, suma incorrecta o motivo faltante.
- 409 `INSUFFICIENT_STOCK`, `NO_OPEN_SHIFT`, `IDEMPOTENCY_CONFLICT`, `QUOTE_CHANGED`, `QUOTE_EXPIRED` o conflicto de unicidad.
- 429: límite de intentos; esperar antes de reintentar.
- 500: operación no confirmada. Reintentar cobro con la misma clave.

No compartir una clave entre dos cobros distintos. Una nueva cotización tras `QUOTE_CHANGED` se confirma explícitamente por el empleado.
