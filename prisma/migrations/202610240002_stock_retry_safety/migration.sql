ALTER TABLE stock_movements ADD COLUMN request_key UUID,
  ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX stock_movements_request_key_key ON stock_movements(request_key);
ALTER TABLE stock_movements ADD CONSTRAINT stock_request_pair CHECK ((request_key IS NULL) = (request_hash IS NULL));
