# Prompt: nuevo sistema de punto de venta para kiosco (reemplazo de "Kiosco POS")

Copiá todo este documento como primer mensaje para la IA o el desarrollador que va a construir el sistema nuevo.

---

## 1. Contexto

Tengo un kiosco en Argentina que hoy funciona con un sistema propio ("Kiosco POS"): backend FastAPI + PostgreSQL en Railway y frontend React (Vite, PWA) en Vercel. Funciona, pero acumuló muchos parches y quiero **reemplazarlo por un sistema nuevo, hecho desde cero, fuera de Railway**.

Condiciones:
- **El sistema actual sigue en uso mientras se construye el nuevo.** No se borra nada hasta que el nuevo esté probado y los datos migrados.
- **Hay que migrar los datos**, sobre todo los ~914 productos con su stock, código de barras, costo y precio. Idealmente también usuarios e historial de ventas (ver sección 7).
- Lo usan 3 empleados y el dueño, **casi siempre desde el celular**, y a veces desde una PC. Tiene que ser mobile-first.
- Todo en español (Argentina) y en pesos argentinos. Zona horaria: `America/Argentina/Buenos_Aires` (UTC-3).

Abajo está **todo lo que hace el sistema actual** (es el alcance mínimo del nuevo) y **los errores que no hay que repetir**.

---

## 2. Usuarios y permisos

Roles:
- **Dueño** (y **admin**, que hoy tiene los mismos permisos): acceso total.
- **Vendedor** (empleado): usa la Caja. Al stock solo accede si el dueño se lo habilita.

Reglas:
- Login con usuario y contraseña. **Sesiones simultáneas**: el mismo usuario puede estar logueado en el celular y en la PC a la vez sin que una cierre la otra. Sesión larga (hoy 7 días) para que nadie quede afuera en pleno turno.
- El usuario de login se guarda **en minúscula y sin espacios**; el login no distingue mayúsculas (los teclados de celular autocapitalizan). No pueden existir "Juan" y "juan" como cuentas distintas.
- **Acceso al stock para vendedores**: el empleado puede "solicitar acceso" desde la pantalla de Stock; el dueño aprueba o rechaza, o lo activa/desactiva directamente desde Usuarios. Si se lo saca, pierde el acceso al instante (también en sesiones ya abiertas).
- Desactivar un usuario no borra su historial (ventas, turnos). Debe poder volver a crearse un usuario con el mismo nombre de login.
- Un usuario desactivado no puede loguearse (mensaje claro, distinto de "contraseña incorrecta").
- **Todos los endpoints exigen sesión**, salvo login y health check. **La identidad del que hace la acción sale de la sesión, nunca de un campo que mande el cliente** (en el sistema actual muchos endpoints reciben `usuario_id` en el body: es un error).

Permisos por acción:

| Acción | Vendedor | Vendedor con stock habilitado | Dueño/Admin |
|---|---|---|---|
| Abrir/cerrar su turno, vender | Sí | Sí | Sí |
| Consumo de empleado (20% off) | Sí | Sí | Sí |
| Ver stock | No | Sí | Sí |
| Crear/editar producto, cargar mercadería, corregir stock | No | Sí | Sí |
| Eliminar producto | No | Sí | Sí |
| Retiro del dueño (consumo sin cobro) | No | No | Sí |
| Anular ventas | No | No | Sí |
| Importar/exportar Excel, fusionar duplicados | No | No | Sí |
| Reportes, panel de turnos, usuarios, auditoría | No | No | Sí |

---

## 3. Turnos de trabajo

- Tres turnos: **Mañana 06–14**, **Tarde 14–22**, **Noche 22–06**. El empleado elige cuál abre.
- Un turno pertenece a un empleado. **Un empleado tiene como máximo un turno abierto.** Sin turno abierto no puede vender.
- Al abrir: monto de caja inicial (hoy la pantalla siempre manda 0; conviene pedirlo de verdad).
- Al cerrar: el empleado cuenta el efectivo y lo ingresa. El sistema calcula:
  - **Efectivo esperado** = caja inicial + efectivo cobrado en el turno (incluida la parte en efectivo de los pagos mixtos).
  - **Diferencia** = contado − esperado (se muestra en verde si cierra, rojo si falta, ámbar si sobra).
  - Resumen del cierre: total vendido, cantidad de ventas, desglose por medio de pago, productos vendidos (agrupados, con cantidad y subtotal) y detalle venta por venta.
- **El turno noche cuenta en el día en que empieza** (el de 22:00 del lunes pertenece al lunes aunque termine el martes a las 06:00).

---

## 4. Caja (punto de venta)

- Campo de búsqueda siempre enfocado: **lector de código de barras** (Enter agrega el producto) o **búsqueda por nombre** con sugerencias (muestran stock y precio).
- Carrito con +/− por ítem, quitar ítem, subtotal y total.
- Debe existir la posibilidad de **ítems sin producto ("venta rápida")** con nombre y precio libres (hoy se mandan con id `rapido-*`; en el backend existe una tabla de "botones rápidos" — Pancho, Cigarrillo suelto, Gomitas — que la pantalla actual no usa). Decidir si se implementan botones rápidos configurables.
- **Medios de pago**: Efectivo, Tarjeta, Mercado Pago (incluye transferencia) y **Mixto** (parte efectivo + parte Mercado Pago; las dos partes tienen que sumar el total, tolerancia $1).
- Efectivo: campo "monto recibido" que calcula el **vuelto** o lo que falta.
- **Recargo nocturno: +10% sobre el total de 22:00 a 06:00 (hora argentina)**. Muy importante para el negocio.
  - Lo decide el servidor con su hora, pero la pantalla tiene que mostrar el mismo total **en el instante exacto** del cambio (a las 22:00 en punto, aunque el celular haya estado bloqueado o sin señal), con un cartel "Tarifa nocturna activa".
  - Mejor diseño: que el servidor devuelva el precio a cobrar (cotización) y la venta se registre con ese mismo valor; si al confirmar el total cambió, avisar cuánto cobrar o devolver.
  - El consumo de empleado **no** lleva recargo.
- **Ventas duplicadas**: con Mercado Pago, si se corta la conexión al cobrar, el empleado reintenta y se duplica. Cada intento de cobro lleva una **clave de idempotencia** guardada en la base (hoy está en memoria del proceso y se pierde al reiniciar).
- **Consumo de empleado**: el empleado se lleva productos con **20% de descuento** y paga en el momento. Hoy la pantalla lo registra como una venta normal con el total ya descontado; además existe en el backend un flujo de "consumo como deuda a cobrar después" que no se usa. Definir cuál de los dos se quiere y registrarlo como tipo de operación propio (no mezclado con ventas).
- **Retiro del dueño**: el dueño saca productos para uso propio. Descuenta stock, no se cobra, se valoriza a **precio de costo**, con motivo.
- **Anulación de venta** (solo dueño, con motivo): devuelve el stock y deja de contar en reportes.
- **Modo sin conexión**: si no hay internet, la venta se guarda localmente y se sincroniza al volver la conexión (hoy es una cola en localStorage, frágil). Debe ser seguro: idempotente y sin vender más stock del que hay.
- En el celular, un desplegable "Este turno" con las ventas del turno y el total por medio de pago.

---

## 5. Stock

- Producto: código de barras (único), nombre, categoría, precio de costo, precio de venta, stock, stock mínimo, activo. Se muestra el % de ganancia.
- **Productos sin control de stock**: hoy existe "Agua caliente" con stock 99.999.302 como truco para que nunca se agote. El nuevo sistema necesita un campo "no controla stock" para servicios o productos que no se cuentan.
- Productos sin código: el sistema les genera uno interno (hoy `SIN-XXXXXXXX`).
- **El stock solo cambia por movimientos registrados**, nunca editando el número a mano:
  - **Venta** (resta), **anulación** (suma), **consumo de empleado** / **retiro del dueño** (restan).
  - **Cargar mercadería** (suma): cantidad + nota opcional (remito, proveedor). La operación es "sumar N", no "fijar el valor".
  - **Corregir por conteo físico** (fija el valor contado): **motivo obligatorio si baja** (rotura, vencido, conteo).
  - **Fusión de duplicados**.
- **Kardex**: cada movimiento queda guardado con tipo, cantidad (+/−), stock antes y después, usuario, fecha, referencia (venta, consumo) y nota. Cada producto tiene un botón de **historial** que lo muestra. Este registro fue lo que permitió descubrir que el stock "que se borraba solo" en realidad lo pisaba otra persona editando.
- **Todo cambio de stock tiene que ser atómico en la base de datos** (`UPDATE ... SET stock = stock - n WHERE id = ? AND stock >= n`), nunca leer el valor, calcular en el cliente y escribir el resultado: con varios celulares a la vez se pierden movimientos.
- Editar un producto (nombre, precios, mínimo, categoría) **no** toca el stock.
- Alertas de **stock bajo** (stock ≤ mínimo).
- **Duplicados**: detectar productos con el mismo nombre y permitir **fusionarlos** (elegir qué código queda; el stock se suma).
- **Eliminar** = baja lógica (no borra historial). Si se vuelve a crear un producto con un código dado de baja, se reactiva.
- **Importar desde Excel** (columnas: código, nombre, costo, venta, stock, mínimo, categoría; crea o actualiza por código) y **exportar a Excel** (marcando en amarillo el stock bajo).
- Lista de stock en el celular: nombre + precio, stock, y botones Cargar / Historial / Editar / Eliminar / Corregir. Búsqueda por nombre o código.
- Los cambios hechos en un dispositivo tienen que verse en los demás sin recargar (hoy: refresco cada 60 s y al volver a la app).

---

## 6. Reportes (dueño)

- **Turnos (lo más usado)**: por **día** (‹ › y calendario para ir a cualquier fecha) y filtro por turno.
  - Arriba: total del día con Efectivo / Mercado Pago / Tarjeta / cantidad de ventas.
  - **Tabla por turno**: turno, empleado, horario, ventas, efectivo, MP, tarjeta, total, estado de caja (cerró bien / diferencia / en curso).
  - **Tabla por empleado**: suma de sus turnos del día, ventas y ticket promedio.
  - Tocando una fila: lo que vendió (productos agrupados) y el control de caja.
  - Los pagos mixtos se reparten entre efectivo y MP según los montos declarados.
- **Hoy**: total vendido, costo, **ganancia neta** (venta − costo de lo vendido), cantidad de ventas, gráfico por medio de pago, ventas por empleado, top 10 productos. Además, el aviso de solicitudes de acceso al stock pendientes.
- **Semana**: últimos 7 días con total y ganancia por día y proyección mensual.
- **Empleados**: últimos turnos con entrada/salida y detalle de lo vendido.
- **Stock**: productos con stock bajo y carga rápida de mercadería.
- **Auditoría / Alertas**: registro de todas las acciones (ventas, cambios de stock, precios, usuarios, turnos) con filtros por fecha, rango horario, empleado y tipo de acción. Contador de alertas nuevas en el menú.
- Sumaría: rango de fechas (semana/mes) en el panel de turnos y exportar reportes a Excel.

---

## 7. Migración de datos

En la carpeta `migracion/` (al lado de este archivo) hay una copia tomada del sistema en producción el 23/10/2026:
- `productos.json` / `productos.csv` / `productos.xlsx`: los **914 productos activos** (id, código, nombre, categoría, costo, venta, stock, mínimo).
- `usuarios.json`: los 5 usuarios activos (nombre, usuario, rol, acceso al stock). **No incluye contraseñas.**
- `turnos_ultimos_100.json`: últimos 100 turnos con sus ventas, como referencia de formato.

Esa copia alcanza para migrar el catálogo. **Para migrar todo (historial de ventas, turnos, Kardex, auditoría, contraseñas) hay que sacar un volcado completo de la base PostgreSQL de Railway** (`pg_dump`, usando la URL pública del servicio Postgres en Railway → Connect → Public Network). Las contraseñas están como hash **bcrypt**: si el sistema nuevo usa bcrypt se pueden migrar tal cual; si no, cada usuario elige una contraseña nueva.

### Esquema actual (PostgreSQL)

Fechas guardadas **sin zona horaria, en hora argentina**.

- `usuarios`: id, nombre, username (único), password_hash (bcrypt), rol (`vendedor` | `admin` | `dueño`), activo, stock_habilitado, creado_en. Los usuarios dados de baja tienen el username renombrado a `nombre__bajaN`.
- `productos`: id, codigo_barra (único), nombre, precio_costo, precio_venta, stock, stock_minimo, categoria, activo, creado_en.
- `turnos`: id, usuario_id, tipo (`mañana` | `tarde` | `noche`), inicio, cierre, monto_apertura, monto_cierre, cerrado.
- `ventas`: id, turno_id, usuario_id, total (ya con recargo nocturno si correspondía), medio_pago (`efectivo` | `tarjeta` | `mercadopago` | `mixto`), monto_efectivo y monto_mp (solo en mixto), fecha, anulada.
- `items_venta`: id, venta_id, producto_id (NULL en ventas rápidas), cantidad, precio_unitario, subtotal.
- `consumos_empleado` + `items_consumo_empleado`: total original, descuento 20%, a cobrar, cobrado.
- `consumos_dueno` + `items_consumo_dueno`: total a costo, motivo.
- `movimientos_stock` (Kardex, desde el 2/10/2026): producto_id, tipo_movimiento (`VENTA`, `INGRESO_MANUAL`, `AJUSTE_POSITIVO`, `AJUSTE_NEGATIVO`, `ANULACION_VENTA`, `CONSUMO_EMPLEADO`, `CONSUMO_DUENO`, `FUSION`), cantidad, stock_anterior, stock_nuevo, usuario_id, referencia, nota, fecha.
- `solicitudes_stock`: usuario_id, estado, fecha.
- `audit_logs`: usuario_id, accion, detalle (texto libre), fecha.
- `botones_rapidos`: nombre, emoji, precio, activo, orden (no se usa en pantalla).

### Limpieza de datos al migrar (detectado en la copia)

- **"Agua caliente"** (código `012`) tiene stock 99.999.302: es un servicio sin control de stock. Migrarlo con "no controla stock".
- **14 productos con precio de venta menor o igual al costo** (por ejemplo "alfajor tita": costo 5000, venta 1500; varios medicamentos). Probablemente el costo es el de la caja y la venta por unidad: revisarlos con el dueño antes de migrar.
- **23 productos sin costo cargado**: la ganancia sale inflada.
- **83 códigos no estándar** (`012`, `24`, `ALIKAL`, `chip claro`, etc.) cargados a mano: mantenerlos, pero que el sistema distinga código escaneable de código interno.
- **Categorías repetidas con distinta escritura**: bebida/bebidas, golosina/golosinas, snack/snacks, comida/comidas, GALLETITAS/galletitas, "art varios"/"art variados"/"articulos varios", una categoría "." y 508 productos en "general". Unificar a una lista fija de categorías.
- Hubo **productos cargados dos veces** con distinto código (mismo nombre): el sistema actual tiene herramienta de fusión; verificar antes de migrar.

### Plan de corte sugerido

1. Construir y probar el sistema nuevo con una copia de los datos.
2. Elegir un momento de poco movimiento, cerrar todos los turnos y frenar las ventas en el sistema viejo.
3. Volcado final, importación y **verificación**: cantidad de productos, suma de stock por producto, totales de ventas por día de la última semana.
4. Pasar a todos al sistema nuevo. Dejar el viejo encendido **solo para consulta** unas semanas y recién después dar de baja Railway.

---

## 8. Errores del sistema actual que el nuevo no debe repetir

1. **Sin migraciones de base de datos** (se usa `create_all`): un campo nuevo en una tabla existente no se crea. Usar migraciones versionadas.
2. **Dependencias sin versión fijada**: un deploy instaló otra versión de SQLAlchemy que eligió otro driver de Postgres y el backend no arrancaba. Fijar versiones (lockfile).
3. **La identidad viene del cliente** (`usuario_id` en el body). Tomarla siempre de la sesión.
4. **Comparaciones de rol y usuario como texto exacto**: una mayúscula o un espacio dejaba a un admin sin permisos. Normalizar y usar valores cerrados (enum).
5. **Stock con "leer, calcular, escribir"**: se perdían movimientos con varios dispositivos. Siempre atómico en la base, con Kardex.
6. **Editar producto pisaba el stock** sin dejar rastro: el stock solo se mueve con operaciones registradas.
7. **El service worker cacheaba respuestas de la API** y mostraba stock viejo (incluso 0). La API nunca se cachea; offline solo para la app y la cola de ventas.
8. **Recargo nocturno calculado distinto en pantalla y servidor**: una sola fuente de verdad.
9. **Fechas sin zona horaria** mezclando hora del servidor (UTC) y hora argentina: guardar en UTC y convertir para mostrar, o usar siempre `timestamptz`.
10. **Idempotencia en memoria**: se pierde al reiniciar. Guardarla en la base.
11. **Secretos y base de datos dentro del repositorio** (`.env`, archivo SQLite, clave JWT por defecto) y usuario inicial `admin/admin123`. Usar variables de entorno del hosting y un alta inicial segura.
12. **Archivos de compilación (`__pycache__`) versionados.**
13. **Mensajes de error genéricos**: el empleado tiene que saber si algo **no se guardó** (sin conexión) y no tener dudas.
14. **Doble clic duplicaba operaciones**: deshabilitar botones mientras se guarda y usar idempotencia.

---

## 9. Decisiones a tomar antes de empezar

- **Hosting nuevo** (el pedido es salir de Railway). Opciones razonables: Supabase (Postgres administrado + autenticación) con frontend en Vercel; o Neon/Render para la base y la API. Que la base tenga backups automáticos.
- **Stack**: se puede mantener React + Python, o pasar a un stack único (por ejemplo Next.js + Postgres). Priorizar lo que sea más fácil de mantener.
- **Consumo de empleado**: pago en el momento (como hoy) o deuda a descontar del sueldo.
- **Botones rápidos** en la Caja (pancho, cigarrillo suelto, etc.): sí o no.
- **Caja inicial**: pedirla al abrir turno o seguir con 0.
- **Medios de pago adicionales** (Cuenta DNI, transferencia separada de MP, etc.).

## 10. Cómo trabajar

- Empezar por modelo de datos, autenticación y permisos; después Caja, Stock, Turnos y Reportes, en ese orden.
- Probar cada flujo en un celular real (pantalla de ~390 px) además de la PC.
- Tests automáticos al menos para: venta con stock insuficiente, venta concurrente del mismo producto desde dos dispositivos, recargo nocturno a las 21:59/22:00/05:59/06:00, pago mixto, cierre de caja con diferencia, permisos por rol e importación de los datos migrados.
