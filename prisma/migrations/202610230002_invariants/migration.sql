-- Reglas que Prisma no expresa como índices parciales y checks.
CREATE UNIQUE INDEX users_active_username ON users (lower(username)) WHERE deleted_at IS NULL;
ALTER TABLE users ADD CONSTRAINT users_normalized_username CHECK (username = lower(username) AND username !~ '\s');
CREATE UNIQUE INDEX shifts_one_open_per_user ON shifts (user_id) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX stock_requests_one_pending ON stock_requests (user_id) WHERE status = 'PENDING';
ALTER TABLE products ADD CONSTRAINT products_nonnegative CHECK (stock >= 0 AND min_stock >= 0 AND cost >= 0 AND price > 0);
ALTER TABLE operation_items ADD CONSTRAINT items_positive CHECK (quantity > 0 AND unit_price >= 0 AND unit_cost >= 0 AND subtotal >= 0);
ALTER TABLE operations ADD CONSTRAINT operations_nonnegative CHECK (total >= 0 AND subtotal >= 0 AND cost >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_nonnegative CHECK (amount >= 0);
ALTER TABLE shifts ADD CONSTRAINT shifts_cash_nonnegative CHECK (opening_cash >= 0 AND (counted_cash IS NULL OR counted_cash >= 0));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_balanced CHECK (after >= 0 AND before >= 0 AND after = before + quantity);

-- Estas tablas son privadas: acceso únicamente mediante el servidor Node.
-- RLS sin políticas impide acceso desde claves públicas de Supabase.
DO $$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','sessions','categories','products','shifts','operations','operation_items','payments','stock_movements','quick_buttons','stock_requests','idempotency','audit_logs','rate_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
