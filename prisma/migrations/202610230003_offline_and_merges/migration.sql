ALTER TABLE products ADD COLUMN merged_into_id UUID;
CREATE INDEX products_merged_into_id_idx ON products(merged_into_id);
ALTER TABLE products ADD CONSTRAINT products_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE offline_conflicts (
  key UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE,
  payload JSONB NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolution TEXT,
  resolved_by UUID,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX offline_conflicts_user_id_idx ON offline_conflicts(user_id);
CREATE INDEX offline_conflicts_resolved_created_at_idx ON offline_conflicts(resolved,created_at);
ALTER TABLE offline_conflicts ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE role_name text; BEGIN
FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
EXECUTE format('REVOKE ALL ON TABLE offline_conflicts FROM %I',role_name);
END IF; END LOOP; END $$;
