# Apertura, continuidad y cierre de turnos

- Solo puede abrirse un turno cuando no queda ningún turno activo en el kiosco. La apertura verifica la base dentro de una transacción; PostgreSQL también rechaza aperturas superpuestas.
- Cada empleado ingresa con su usuario, abre su turno y declara el efectivo inicial. Solo ese empleado puede cerrar y rendir ese turno.
- Apagar la PC, cerrar el navegador, cerrar sesión, cambiar de equipo o pasar de franja horaria no cierra ni reemplaza el turno. Las operaciones confirmadas permanecen en Supabase y se recuperan al ingresar con el mismo usuario.
- Para terminar, entrar a **Mi turno**, contar el efectivo y confirmar **Cerrar turno y ver diferencia**. La próxima apertura genera otro identificador y comienza sin las ventas del anterior.
- El cierre envía el identificador exacto del turno. Repetir ese cierre con el mismo efectivo devuelve su resultado original; nunca cierra un turno nuevo. Cambiar el efectivo de un turno cerrado o reabrirlo está bloqueado.
- El cobro y el cierre bloquean la misma fila: el efectivo esperado incluye las ventas confirmadas antes del cierre. No se admiten nuevas ventas en un turno cerrado. Reintentar un cobro ya confirmado conserva su operación original.
- El cierre confirmado invalida su copia offline y avisa a las otras pestañas del navegador. Otro equipo conectado actualiza su vista al consultar el servidor. Un equipo sin red no puede enterarse de un cierre remoto hasta reconectarse: sus cobros locales siguen siendo pendientes y no se trasladan al turno siguiente.

## Turnos pendientes anteriores a esta protección

La migración `202611090001_shift_lifecycle` no cierra turnos ni modifica ventas, pagos, stock o importes anteriores. Si ya había varios turnos abiertos, cada empleado debe ingresar con su usuario y rendir el suyo. Mientras quede cualquiera de ellos abierto, no se habilita una nueva apertura. Después de completar esos cierres, el relevo es de un turno a la vez.

Tras publicar la actualización, recargar las pantallas abiertas para que envíen el identificador del turno al cerrar. Una versión anterior que omita ese dato no puede cerrar una caja.

Antes de cerrar conviene sincronizar los cobros pendientes. Las ventas todavía guardadas exclusivamente en un dispositivo sin conexión no pueden recuperarse desde otro equipo si se pierde ese dispositivo.
