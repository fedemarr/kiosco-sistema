ALTER TABLE products ADD COLUMN sellable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN review_note TEXT;
ALTER TABLE products DROP CONSTRAINT products_nonnegative;
ALTER TABLE products ADD CONSTRAINT products_nonnegative CHECK (
  stock >= 0 AND min_stock >= 0 AND cost >= 0 AND price >= 0 AND (NOT sellable OR price > 0)
);
ALTER TABLE shifts ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
DROP INDEX shifts_one_open_per_user;
CREATE UNIQUE INDEX shifts_one_open_per_user ON shifts (user_id) WHERE closed_at IS NULL AND NOT archived;
ALTER TABLE operations ADD COLUMN historical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cost_known BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN unallocated_payment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations ADD CONSTRAINT operations_unallocated_payment CHECK (unallocated_payment >= 0 AND unallocated_payment <= total);
CREATE TABLE import_batches (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  summary JSONB NOT NULL,
  source_data JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE import_batches FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
