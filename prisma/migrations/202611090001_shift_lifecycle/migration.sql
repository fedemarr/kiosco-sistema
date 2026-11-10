-- Los turnos anteriores se conservan para que cada empleado rinda su caja.
-- No se cierran ni se modifican ventas al instalar esta protección.
CREATE FUNCTION guard_shift_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'Un turno cerrado no se puede reabrir ni volver a cerrar' USING ERRCODE = '23514';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'No se puede cambiar el empleado de un turno' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.closed_at IS NULL AND NOT NEW.archived THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM pg_advisory_xact_lock(730911);
      IF EXISTS (SELECT 1 FROM shifts WHERE closed_at IS NULL AND NOT archived) THEN
        RAISE EXCEPTION 'Debe cerrarse el turno abierto antes de abrir otro' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.archived THEN
      RAISE EXCEPTION 'Un turno histórico no puede convertirse en turno activo' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shifts_guard_lifecycle BEFORE INSERT OR UPDATE ON shifts
FOR EACH ROW EXECUTE FUNCTION guard_shift_lifecycle();
