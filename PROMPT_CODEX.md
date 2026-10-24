Vas a construir desde cero el sistema de punto de venta de mi kiosco, que reemplaza al sistema actual "Kiosco POS". Trabajás en este repositorio de forma autónoma, por etapas, hasta tener el sistema completo funcionando.

## Material de referencia (leelo entero antes de escribir código)

- `docs/ESPECIFICACION.md`: qué hace el sistema actual (alcance mínimo), reglas de negocio, esquema de la base actual, plan de migración y la lista de errores que NO hay que repetir. Es la fuente de verdad del comportamiento.
- `data/migracion/productos.json` (914 productos), `data/migracion/usuarios.json` (5 usuarios, sin contraseñas), `data/migracion/turnos_ultimos_100.json` (ejemplo real de turnos y ventas). Son datos reales de producción: no los modifiques; el importador los lee.

Si algo de este prompt contradice a `docs/ESPECIFICACION.md`, manda este prompt (son decisiones ya tomadas).

## Decisiones ya tomadas

**Stack**
- Next.js (App Router) + TypeScript estricto + Tailwind CSS. Un solo proyecto: interfaz y API (route handlers / server actions).
- PostgreSQL con **Prisma** (migraciones versionadas; nunca `db push` en producción). En desarrollo, Postgres en Docker (`docker-compose.yml`). En producción, **Supabase** (solo como Postgres administrado) y deploy en **Vercel**.
- Autenticación propia: usuario + contraseña con **bcrypt** (para poder migrar los hashes actuales), sesión en cookie httpOnly firmada, duración 7 días, sesiones simultáneas permitidas. Nada de emails: los empleados no tienen.
- Validación con **Zod** en toda entrada del servidor.
- Tests: **Vitest** para lógica y API contra una base de test real, **Playwright** para flujos de punta a punta en viewport de celular (390x844) y de PC.
- Fechas: guardar en UTC (`timestamptz`), mostrar y calcular reglas de negocio en `America/Argentina/Buenos_Aires`.
- Dinero: guardar en **centavos como entero**. Mostrar como `$12.700` (formato es-AR).
- Versiones fijadas con lockfile.

**Negocio (valores por defecto)**
- Consumo de empleado: 20% off, **se paga en el momento**, se registra como operación propia (no como venta común) y **sin recargo nocturno**.
- **Botones rápidos configurables** en la Caja (por defecto: Pancho $2.000, Cigarrillo suelto $1.500, Gomitas $500), editables por el dueño.
- **Caja inicial**: se pide al abrir el turno.
- Medios de pago: Efectivo, Tarjeta, Mercado Pago/Transferencia y Mixto (efectivo + MP).
- Recargo nocturno: +10% de 22:00 a 06:00 hora argentina. Lo decide el servidor: la Caja pide una **cotización** del carrito y la venta se registra con ese mismo total. Si al confirmar cambió (por ejemplo, justo a las 22:00), el servidor responde el total nuevo y la pantalla avisa cuánto cobrar o devolver. La pantalla además cambia sola al modo nocturno a las 22:00 exactas.
- Productos con opción **"no controla stock"** (servicios como "Agua caliente").
- Categorías: lista fija administrable por el dueño. El importador unifica las variantes (ver "Limpieza de datos" en la especificación).

## Reglas no negociables (resumen; el detalle está en la especificación)

1. Todo endpoint exige sesión (salvo login y `/api/health`). **La identidad sale de la sesión, nunca del body.** Permisos según la tabla de la sección 2 de la especificación, verificados en el servidor.
2. **El stock solo cambia por movimientos registrados en el Kardex** (venta, anulación, carga de mercadería, corrección por conteo con motivo obligatorio si baja, consumo de empleado, retiro del dueño, fusión). Cada cambio es atómico en la base: `UPDATE ... SET stock = stock - n WHERE id = $1 AND stock >= n` dentro de una transacción junto con el movimiento y la venta. Editar un producto nunca toca el stock.
3. **Idempotencia persistida** en la base para cobrar y para sincronizar ventas offline: reintentar nunca duplica.
4. La API nunca se cachea en el service worker.
5. Usuario de login normalizado (minúscula, sin espacios, único sin distinguir mayúsculas). Roles como enum.
6. Errores claros para el empleado: distinguir "no se guardó (sin conexión)" de "error de validación". Botones deshabilitados mientras se guarda.
7. Nada de secretos en el repo: `.env.example` documentado y `.env` en `.gitignore`. El primer usuario dueño se crea con un comando (`npm run crear-dueno`) que pide la contraseña; no hay usuario por defecto.
8. Interfaz mobile-first, en español rioplatense, tema oscuro, botones de al menos 44 px, sin scroll horizontal en 390 px.

## Etapas

Hacé las etapas en orden. Al terminar cada una: tests pasando, lint y typecheck sin errores, un commit con mensaje descriptivo y `PROGRESS.md` actualizado (qué está hecho, qué falta, decisiones tomadas). No pases a la siguiente con tests en rojo. Si una decisión no está cubierta por este prompt ni por la especificación, elegí la opción más simple y segura, anotala en `PROGRESS.md` en "Decisiones a confirmar" y seguí: no frenes.

**Etapa 0. Base del proyecto.** Next.js + TypeScript + Tailwind + Prisma + Docker Postgres + Vitest + Playwright + ESLint/Prettier. Crear `AGENTS.md` con los comandos (instalar, levantar base, migrar, seed, test, e2e) y las reglas no negociables de arriba. `README.md` con cómo correrlo localmente. CI de GitHub Actions que corre lint, typecheck y tests.

**Etapa 1. Modelo de datos, autenticación y permisos.** Esquema Prisma con usuarios, productos, categorías, turnos, ventas, ítems de venta, pagos, consumos de empleado, retiros del dueño, movimientos de stock (Kardex), botones rápidos, solicitudes de acceso al stock, claves de idempotencia y auditoría. Login, logout, sesión, middleware de permisos, alta del dueño por comando. Tests de permisos por rol (incluido vendedor con y sin stock habilitado).

**Etapa 2. Productos y stock.** Lista con búsqueda por nombre o código, alta y edición, baja lógica con reactivación por código, cargar mercadería, corregir por conteo, historial (Kardex) por producto, alertas de stock bajo, detección y fusión de duplicados, importar y exportar Excel (mismas columnas que el sistema actual), solicitudes de acceso al stock. Test de concurrencia: dos operaciones simultáneas sobre el mismo producto no pierden movimientos.

**Etapa 3. Turnos y Caja.** Abrir turno (mañana 06–14, tarde 14–22, noche 22–06; uno abierto por empleado; caja inicial), Caja con lector de código y búsqueda, carrito, botones rápidos, medios de pago con vuelto y mixto, cotización con recargo nocturno, cobro idempotente, consumo de empleado, retiro del dueño, anulación por el dueño, cierre de turno con efectivo esperado/contado/diferencia y resumen. Tests del recargo en 21:59, 22:00, 05:59 y 06:00 (con reloj simulado), venta sin stock suficiente, venta concurrente del último ítem desde dos dispositivos, pago mixto que no suma.

**Etapa 4. Reportes del dueño.** Panel de Turnos por día (total del día por medio de pago; tabla por turno con empleado, ventas, efectivo, MP, tarjeta, total y estado de caja; tabla por empleado con ticket promedio; detalle desplegable con productos vendidos y control de caja; el turno noche cuenta en el día en que empieza), Hoy (total, costo, ganancia neta, por medio de pago, por empleado, top productos), Semana con proyección, historial de turnos por empleado, auditoría con filtros. Agregar rango de fechas (semana/mes) al panel de turnos y exportar a Excel.

**Etapa 5. PWA y modo offline.** Instalable en el celular. Si no hay conexión, las ventas se guardan en IndexedDB con su clave de idempotencia y se sincronizan al volver; el servidor valida stock al sincronizar y lo que no se pueda registrar queda visible para el dueño. La app refresca stock y turnos al volver a primer plano.

**Etapa 6. Migración.** Script `npm run migrar` que importa `data/migracion/*.json` en una base vacía: productos (limpiando categorías, marcando "Agua caliente" como "no controla stock" y conservando los códigos manuales), usuarios (sin contraseña: quedan con contraseña temporal a cambiar en el primer ingreso), y un informe en consola con lo importado, lo descartado y los productos a revisar (venta menor o igual al costo, sin costo). Además, un importador opcional desde un `pg_dump` del sistema viejo (esquema en la sección 7 de la especificación) que traiga historial de ventas, turnos, Kardex y hashes bcrypt. Verificación posterior: cantidad de productos y suma de stock iguales a la fuente.

**Etapa 7. Deploy.** Guía en `docs/DEPLOY.md` para Supabase + Vercel (variables de entorno, migraciones en el deploy, backups automáticos de Supabase) y un checklist de corte basado en el "Plan de corte" de la especificación.

## Al terminar

Dejá en `PROGRESS.md`: estado de cada etapa, cómo probar todo localmente paso a paso, decisiones a confirmar conmigo y cualquier dato de la migración que haya que revisar a mano.

Empezá ahora por la Etapa 0.
